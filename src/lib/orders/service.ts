/**
 * Orders. The browser only ever sends variant ids, quantities and a code.
 * Prices, costs, stock, discounts and totals are all read or computed here.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../db/client";
import {
  categories, customers, inventory, orderEvents, orderItems, orders, payments, productVariants, products, refunds, salesChannels,
} from "../db/schema";
import { STORE, orderNumber } from "../config";
import { BusinessError, InsufficientStockError, NotFoundError, ValidationError } from "../errors";
import { type Actor, STOREFRONT_ACTOR, assertCan } from "../auth/permissions";
import { audit, notify } from "../audit";
import { formatMoney } from "../money";
import { computeTotals, type PricedLine, type Totals } from "./pricing";
import { consumeDiscount, validateDiscount, type DiscountRow } from "../discounts/service";
import { applyMovement, lockInventory, release, reserve } from "../inventory/service";

export type OrderStatus = typeof orders.$inferSelect["status"];
export type CartLine = { variantId: string; quantity: number; personalization?: { initial?: string; engraving?: string } };
export type QuoteInput = { lines: CartLine[]; discountCode?: string | null; channel?: string; express?: boolean; customerId?: string | null };

type LoadedLine = PricedLine & { variantId: string; sku: string; productName: string; variantLabel: string; available: number; personalization?: CartLine["personalization"] };
export type Quote = Totals & { lines: LoadedLine[]; discount: DiscountRow | null; discountError: string | null; problems: string[] };

const MATERIAL: Record<string, string> = { yg: "14K Yellow Gold", wg: "14K White Gold", vm: "18K Gold Vermeil", ss: "Sterling Silver" };
export const variantLabel = (v: { material: string; size: string | null; gemstone: string | null }) =>
  [MATERIAL[v.material] ?? v.material, v.gemstone, v.size].filter(Boolean).join(" / ");

function normalizeLines(lines: CartLine[]): CartLine[] {
  const merged = new Map<string, CartLine>();
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > STORE.maxQuantityPerLine) throw new ValidationError(`Quantity must be between 1 and ${STORE.maxQuantityPerLine}.`);
    const key = `${l.variantId}|${l.personalization?.initial ?? ""}|${l.personalization?.engraving ?? ""}`;
    const ex = merged.get(key);
    if (ex) ex.quantity += l.quantity; else merged.set(key, { ...l });
  }
  return [...merged.values()];
}

async function loadChannel(tx: DbOrTx, key: string) {
  const [c] = await tx.select().from(salesChannels).where(eq(salesChannels.key, key));
  if (!c) throw new ValidationError(`Unknown sales channel "${key}".`);
  return c;
}

async function priceLines(tx: DbOrTx, lines: CartLine[]) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (!ids.length) return { loaded: [] as LoadedLine[], problems: ["Your bag is empty."] };
  const rows = await tx.select({
    id: productVariants.id, sku: productVariants.sku, material: productVariants.material, size: productVariants.size, gemstone: productVariants.gemstone,
    priceCents: productVariants.priceCents, costCents: productVariants.costCents, active: productVariants.active,
    productId: products.id, productName: products.name, status: products.status, categoryId: categories.id,
    onHand: inventory.onHand, reserved: inventory.reserved,
  }).from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(inArray(productVariants.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const problems: string[] = [];
  const loaded: LoadedLine[] = [];
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.variantId, (wanted.get(l.variantId) ?? 0) + l.quantity);
  for (const l of lines) {
    const r = byId.get(l.variantId);
    if (!r || !r.active || r.status !== "active") { problems.push(`${r?.productName ?? "An item"} is no longer available.`); continue; }
    const avail = r.onHand - r.reserved;
    if (avail < (wanted.get(l.variantId) ?? 0)) problems.push(avail > 0 ? `${r.productName} (${variantLabel(r)}) has only ${avail} left.` : `${r.productName} (${variantLabel(r)}) is sold out.`);
    loaded.push({
      variantId: r.id, sku: r.sku, productId: r.productId, categoryId: r.categoryId, productName: r.productName, variantLabel: variantLabel(r),
      unitPriceCents: r.priceCents, unitCostCents: r.costCents, quantity: l.quantity, available: avail, personalization: l.personalization,
    });
  }
  return { loaded, problems };
}

/** Price a cart for display. Never trusts anything but ids and quantities. */
export async function quoteCart(db: DbOrTx, input: QuoteInput): Promise<Quote> {
  const lines = normalizeLines(input.lines);
  const channel = await loadChannel(db, input.channel ?? "web");
  const { loaded, problems } = await priceLines(db, lines);
  let discount: DiscountRow | null = null, discountError: string | null = null;
  if (input.discountCode) {
    try { discount = await validateDiscount(db, input.discountCode, loaded, input.customerId ?? null); }
    catch (e) { if (e instanceof BusinessError) discountError = e.message; else throw e; }
  }
  return { ...computeTotals(loaded, discount, channel, !!input.express), lines: loaded, discount, discountError, problems };
}

export type PlaceOrderInput = QuoteInput & {
  customer: { email: string; name: string; phone?: string };
  shippingAddress?: Record<string, string>;
  /** "paid" deducts stock now (manual, in-store, or payment already captured). "pending" reserves stock until markOrderPaid. */
  status?: "pending" | "paid";
  paymentProvider?: string;
  paymentRef?: string | null;
  /** Only for seed scripts importing history. */
  placedAt?: Date;
};

async function upsertCustomer(tx: Tx, c: PlaceOrderInput["customer"], at?: Date) {
  const email = c.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  const [row] = await tx.insert(customers).values({ email, name: c.name.trim() || email, phone: c.phone ?? null, ...(at ? { createdAt: at } : {}) })
    .onConflictDoUpdate({ target: customers.email, set: { name: sql`coalesce(nullif(excluded.name, ''), ${customers.name})` } })
    .returning({ id: customers.id });
  return row!.id;
}

export async function placeOrder(db: Db, input: PlaceOrderInput, actor: Actor = STOREFRONT_ACTOR) {
  if (actor !== STOREFRONT_ACTOR) assertCan(actor, "orders:write");
  const lines = normalizeLines(input.lines);
  const status = input.status ?? "pending";
  return db.transaction(async (tx) => {
    const at = input.placedAt ?? new Date();
    const channel = await loadChannel(tx, input.channel ?? "web");
    const customerId = await upsertCustomer(tx, input.customer, input.placedAt);
    // Lock stock rows first, then price. Anything read after the lock is consistent.
    const locked = await lockInventory(tx, lines.map((l) => l.variantId));
    const { loaded, problems } = await priceLines(tx, lines);
    if (problems.length) throw new InsufficientStockError(problems[0]!);
    let discount: DiscountRow | null = null;
    if (input.discountCode) discount = await validateDiscount(tx, input.discountCode, loaded, customerId, at);
    const t = computeTotals(loaded, discount, channel, !!input.express);

    const [order] = await tx.insert(orders).values({
      customerId, channel: channel.key, status,
      subtotalCents: t.subtotalCents, discountCents: t.discountCents, shippingChargedCents: t.shippingChargedCents, shippingCostCents: t.shippingCostCents,
      taxCents: t.taxCents, totalCents: t.totalCents, paymentFeeCents: t.paymentFeeCents,
      discountCode: discount?.code ?? null, expressShipping: !!input.express, shippingAddress: input.shippingAddress ?? null,
      placedAt: at, paidAt: status === "paid" ? at : null, createdByUserId: actor.userId,
    }).returning();
    if (!order) throw new Error("Order insert failed");
    const ref = orderNumber(order.number);

    await tx.insert(orderItems).values(loaded.map((l) => ({
      orderId: order.id, variantId: l.variantId, productId: l.productId, sku: l.sku, productName: l.productName, variantLabel: l.variantLabel,
      quantity: l.quantity, unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, personalization: l.personalization ?? null,
    })));

    for (const l of loaded) {
      const row = locked.get(l.variantId)!;
      if (status === "paid") await applyMovement(tx, row, { variantId: l.variantId, quantity: -l.quantity, type: "SALE", reference: ref, orderId: order.id, userId: actor.userId, notes: channel.name, at });
      else await reserve(tx, row, l.quantity);
    }
    if (discount && t.discountCents + (discount.type === "free_shipping" ? 1 : 0) > 0) await consumeDiscount(tx, discount, order.id, customerId, t.discountCents);

    await tx.insert(orderEvents).values([
      { orderId: order.id, status: "pending", createdAt: at, userId: actor.userId },
      ...(status === "paid" ? [{ orderId: order.id, status: "paid" as const, createdAt: at, userId: actor.userId }] : []),
    ]);
    await tx.insert(payments).values({
      orderId: order.id, provider: input.paymentProvider ?? (channel.key === "web" ? "stripe" : "manual"), providerRef: input.paymentRef ?? null,
      status: status === "paid" ? "succeeded" : "pending", amountCents: t.totalCents, feeCents: t.paymentFeeCents, createdAt: at,
    });
    if (status === "paid") await announcePaid(tx, order.number, t.totalCents, input.customer.name, channel.name);
    if (actor.userId) await audit(tx, actor, "Created order", "order", ref, undefined, { channel: channel.key, totalCents: t.totalCents });
    return { ...order, reference: ref };
  });
}

async function announcePaid(tx: Tx, number: number, totalCents: number, customerName: string, channelName: string) {
  const large = totalCents >= STORE.largeOrderCents;
  await notify(tx, large ? "large_order" : "new_order", `${large ? "Large order" : "New order"} ${orderNumber(number)}`, `${formatMoney(totalCents)} from ${customerName}, ${channelName}`, orderNumber(number));
}

async function lockOrder(tx: Tx, orderId: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o) throw new NotFoundError("Order not found.");
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { o, items };
}

/** Payment confirmed (e.g. Stripe webhook). Idempotent: a repeated webhook changes nothing. */
export async function markOrderPaid(db: Db, orderId: string, payment: { providerRef?: string; feeCents?: number } = {}) {
  return db.transaction(async (tx) => {
    const { o, items } = await lockOrder(tx, orderId);
    if (o.status !== "pending") return { alreadyProcessed: true };
    const locked = await lockInventory(tx, items.map((i) => i.variantId));
    const ref = orderNumber(o.number);
    for (const i of items) await applyMovement(tx, locked.get(i.variantId)!, { variantId: i.variantId, quantity: -i.quantity, reservedDelta: -i.quantity, type: "SALE", reference: ref, orderId: o.id });
    const now = new Date();
    await tx.update(orders).set({ status: "paid", paidAt: now, ...(payment.feeCents != null ? { paymentFeeCents: payment.feeCents } : {}) }).where(eq(orders.id, o.id));
    await tx.update(payments).set({ status: "succeeded", providerRef: payment.providerRef ?? null, ...(payment.feeCents != null ? { feeCents: payment.feeCents } : {}) }).where(and(eq(payments.orderId, o.id), eq(payments.status, "pending")));
    await tx.insert(orderEvents).values({ orderId: o.id, status: "paid" });
    const [c] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, o.customerId));
    const [ch] = await tx.select({ name: salesChannels.name }).from(salesChannels).where(eq(salesChannels.key, o.channel));
    await announcePaid(tx, o.number, o.totalCents, c?.name ?? "", ch?.name ?? o.channel);
    return { alreadyProcessed: false };
  });
}

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["processing", "cancelled", "refunded"],
  processing: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

/**
 * Staff status change. Cancelling a pending order releases its reservation.
 * Cancelling or refunding a paid order returns the items to stock (RETURN movements)
 * and, for refunds, records the refund against revenue.
 */
export async function updateOrderStatus(db: Db, actor: Actor, orderId: string, next: OrderStatus, opts: { reason?: string; restock?: boolean } = {}) {
  assertCan(actor, "orders:write");
  if (next === "paid") { const r = await markOrderPaid(db, orderId); if (r.alreadyProcessed) throw new ValidationError("This order is already paid."); return; }
  return db.transaction(async (tx) => {
    const { o, items } = await lockOrder(tx, orderId);
    if (!TRANSITIONS[o.status].includes(next)) throw new ValidationError(`An order that is ${o.status} cannot become ${next}.`);
    const ref = orderNumber(o.number);
    const restock = opts.restock ?? true;
    const locked = await lockInventory(tx, items.map((i) => i.variantId));
    if (o.status === "pending" && next === "cancelled") {
      for (const i of items) await release(tx, locked.get(i.variantId)!, i.quantity);
    } else if (next === "cancelled" || next === "refunded") {
      if (restock) for (const i of items) await applyMovement(tx, locked.get(i.variantId)!, { variantId: i.variantId, quantity: i.quantity, type: "RETURN", reference: ref, orderId: o.id, userId: actor.userId, notes: next === "cancelled" ? "Order cancelled" : opts.reason ?? "Refunded" });
    }
    const set: Partial<typeof orders.$inferInsert> = { status: next };
    if (next === "refunded" || (next === "cancelled" && o.paidAt)) {
      // Revenue portion refunded. Tax and shipping refunds are pass-through and not revenue.
      const amount = o.subtotalCents - o.discountCents;
      set.refundedCents = amount;
      await tx.insert(refunds).values({ orderId: o.id, amountCents: amount, reason: opts.reason ?? next, restocked: restock, userId: actor.userId });
      await tx.update(payments).set({ status: "refunded" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "succeeded")));
      await notify(tx, "refund", `Refund issued ${ref}`, `${formatMoney(amount)} refunded`, ref);
    }
    await tx.update(orders).set(set).where(eq(orders.id, o.id));
    await tx.insert(orderEvents).values({ orderId: o.id, status: next, note: opts.reason ?? null, userId: actor.userId });
    await audit(tx, actor, "Changed order status", "order", ref, { status: o.status }, { status: next });
  });
}
