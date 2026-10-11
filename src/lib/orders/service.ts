/**
 * Orders. The browser only ever sends variant ids, quantities, a discount code and addresses.
 * Prices, costs, stock, discounts, totals and profit are read or computed here, in one transaction.
 * See docs/BUSINESS_LOGIC.md for the full flow.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../db/client";
import {
  acquisitionSource, categories, customers, inventory, marketingAttributions, orderEvents, orderItems, orders, payments, productVariants, products, refunds, salesChannels, shippingMethods,
  type VariantSnapshot,
} from "../db/schema";
import { STORE } from "../config";
import { BusinessError, InsufficientStockError, NotFoundError, ValidationError } from "../errors";
import { type Actor, STOREFRONT_ACTOR, assertCan } from "../auth/permissions";
import { audit, emit, notify } from "../audit";
import { formatMoney } from "../money";
import { materialName } from "../format";
import { computeTotals, marginPct, type PricedLine, type ResolvedShippingMethod, type Totals } from "./pricing";
import { consumeDiscount, validateDiscount, type DiscountRow } from "../discounts/service";
import { applyMovement, lockInventory, release, reserve } from "../inventory/service";
import { earnPointsForOrder, reversePointsForRefund } from "../loyalty/service";
import { markCartRecovered } from "../marketing/abandoned-carts";
import { resolveCampaignId } from "../marketing/campaigns";
import { recordOrderEvent } from "../marketing/events";

type OrderRow = typeof orders.$inferSelect;
export type OrderStatus = OrderRow["status"];
export type CartLine = { variantId: string; quantity: number; personalization?: { initial?: string; engraving?: string } };
export type QuoteInput = { lines: CartLine[]; discountCode?: string | null; channel?: string; express?: boolean; customerId?: string | null; shippingMethodId?: string | null };

type LoadedLine = PricedLine & { variantId: string; sku: string; productName: string; snapshot: VariantSnapshot; available: number; personalization?: CartLine["personalization"] };
export type Quote = Totals & { lines: LoadedLine[]; discount: DiscountRow | null; discountError: string | null; problems: string[] };

/** "14K Yellow Gold / Size 6". Color is shown only when the material name does not already say it. */
export const variantLabel = (v: { material: string; size: string | null; gemstone: string | null; color?: string | null }) => {
  const material = materialName(v.material);
  const color = v.color && !material.includes(v.color) ? v.color : null;
  return [material, color, v.gemstone, v.size && (/^\d+$/.test(v.size) ? `Size ${v.size}` : v.size)].filter(Boolean).join(" / ");
};

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

async function loadChannel(tx: DbOrTx, code: string) {
  const [c] = await tx.select().from(salesChannels).where(eq(salesChannels.code, code));
  if (!c || !c.active) throw new ValidationError(`Unknown sales channel "${code}".`);
  return c;
}

/** Never trust a shipping price from the browser — only the id. Also the server-side half of
 *  `calculateShipping()` (brief §17): a method restricted to a country/region or an order-value band is
 *  rejected here even if the browser somehow submitted its id. */
async function loadShippingMethod(tx: DbOrTx, id: string | null | undefined, ctx?: { subtotalCents: number; countryCode?: string | null; region?: string | null }): Promise<ResolvedShippingMethod | null> {
  if (!id) return null;
  const [m] = await tx.select().from(shippingMethods).where(and(eq(shippingMethods.id, id), eq(shippingMethods.active, true)));
  if (!m) throw new ValidationError("Choose a shipping method.");
  if (ctx) {
    if (m.countryCode && ctx.countryCode && m.countryCode !== ctx.countryCode) throw new ValidationError(`${m.name} is not available for this destination.`);
    if (m.region && ctx.region && m.region !== ctx.region) throw new ValidationError(`${m.name} is not available for this destination.`);
    if (m.minOrderCents != null && ctx.subtotalCents < m.minOrderCents) throw new ValidationError(`${m.name} requires a minimum order.`);
    if (m.maxOrderCents != null && ctx.subtotalCents > m.maxOrderCents) throw new ValidationError(`${m.name} is not available for orders this large.`);
  }
  return { id: m.id, priceCents: m.priceCents, carrierCostCents: m.carrierCostCents, waivableAboveThreshold: m.waivableAboveThreshold };
}

async function priceLines(tx: DbOrTx, lines: CartLine[]) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (!ids.length) return { loaded: [] as LoadedLine[], problems: ["Your bag is empty."] };
  const rows = await tx.select({
    id: productVariants.id, sku: productVariants.sku, material: productVariants.material, size: productVariants.size, color: productVariants.color, gemstone: productVariants.gemstone,
    price: productVariants.sellingPriceCents, cost: productVariants.costPriceCents, vStatus: productVariants.status,
    productId: products.id, productName: products.name, pStatus: products.status, categoryId: categories.id, collectionId: products.collectionId,
    stock: inventory.stockQuantity, reserved: inventory.reservedQuantity,
  }).from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(inArray(productVariants.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.variantId, (wanted.get(l.variantId) ?? 0) + l.quantity);
  const problems: string[] = [];
  const loaded: LoadedLine[] = [];
  for (const l of lines) {
    const r = byId.get(l.variantId);
    if (!r || r.vStatus !== "active" || r.pStatus !== "active") { problems.push(`${r?.productName ?? "An item"} is no longer available.`); continue; }
    const avail = r.stock - r.reserved;
    const label = variantLabel(r);
    if (avail < (wanted.get(l.variantId) ?? 0)) problems.push(avail > 0 ? `Only ${avail} ${avail === 1 ? "unit" : "units"} of ${r.productName} (${label}) available.` : `${r.productName} (${label}) is sold out.`);
    loaded.push({
      variantId: r.id, sku: r.sku, productId: r.productId, categoryId: r.categoryId, collectionId: r.collectionId, productName: r.productName,
      snapshot: { material: r.material, size: r.size, color: r.color, gemstone: r.gemstone, label },
      unitPriceCents: r.price, unitCostCents: r.cost, quantity: l.quantity, available: avail, personalization: l.personalization,
    });
  }
  return { loaded, problems };
}

/** Price a cart for display. Never trusts anything but ids and quantities. */
export async function quoteCart(db: DbOrTx, input: QuoteInput): Promise<Quote> {
  const lines = normalizeLines(input.lines);
  const channel = await loadChannel(db, input.channel ?? "WEBSITE");
  const { loaded, problems } = await priceLines(db, lines);
  let discount: DiscountRow | null = null, discountError: string | null = null;
  if (input.discountCode) {
    try { discount = await validateDiscount(db, input.discountCode, loaded, input.customerId ?? null); }
    catch (e) { if (e instanceof BusinessError) discountError = e.message; else throw e; }
  }
  const shippingMethod = await loadShippingMethod(db, input.shippingMethodId);
  return { ...computeTotals(loaded, discount, channel, !!input.express, shippingMethod), lines: loaded, discount, discountError, problems };
}

/* ------------------------------------------------------------ status model */
/** The three status fields always move together. This is the only place that maps them. */
export function statusFields(next: OrderStatus, prev?: Pick<OrderRow, "fulfillmentStatus" | "paidAt">): Pick<OrderRow, "status" | "paymentStatus" | "fulfillmentStatus"> {
  switch (next) {
    case "pending": return { status: next, paymentStatus: "unpaid", fulfillmentStatus: "unfulfilled" };
    case "paid": return { status: next, paymentStatus: "paid", fulfillmentStatus: "unfulfilled" };
    case "processing": return { status: next, paymentStatus: "paid", fulfillmentStatus: "processing" };
    case "shipped": return { status: next, paymentStatus: "paid", fulfillmentStatus: "shipped" };
    case "delivered": return { status: next, paymentStatus: "paid", fulfillmentStatus: "delivered" };
    case "cancelled": return { status: next, paymentStatus: prev?.paidAt ? "refunded" : "unpaid", fulfillmentStatus: "cancelled" };
    // A refund is a money-only event (brief §42) — it must never overwrite real fulfillment/return progress
    // (Phase 5's own `return_requests.status` is the source of truth for "was this actually returned").
    // Only downgrade fulfillment_status when nothing had actually started yet.
    case "refunded": return { status: next, paymentStatus: "refunded", fulfillmentStatus: prev?.fulfillmentStatus && prev.fulfillmentStatus !== "unfulfilled" ? prev.fulfillmentStatus : "cancelled" };
  }
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

/* ------------------------------------------------------------ place order */
export type PlaceOrderInput = QuoteInput & {
  customer: { email: string; name: string; phone?: string };
  /** First-touch is captured once and never overwritten; last-touch updates on every order (brief §8). */
  acquisition?: { source: (typeof acquisitionSource.enumValues)[number]; details?: Record<string, string | undefined> };
  shippingAddress?: Record<string, string>;
  billingAddress?: Record<string, string>;
  notes?: string;
  /** "paid": payment already captured (in-store, manual, confirmed) → stock is deducted now.
   *  "pending": awaiting payment (Stripe Checkout) → stock is reserved until markOrderPaid. */
  status?: "pending" | "paid";
  paymentProvider?: string;
  paymentRef?: string | null;
  /** Only for seed scripts importing history. */
  placedAt?: Date;
};

type TouchSnapshot = { source: (typeof acquisitionSource.enumValues)[number] | null; details: Record<string, string | undefined> | null };
async function upsertCustomer(tx: Tx, c: PlaceOrderInput["customer"], at?: Date, acquisition?: PlaceOrderInput["acquisition"]): Promise<{ id: string; firstTouch: TouchSnapshot; lastTouch: TouchSnapshot }> {
  const email = c.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  const name = c.name.trim() || email;
  const [existing] = await tx.select({ id: customers.id, firstTouchSource: customers.firstTouchSource, firstTouchDetails: customers.firstTouchDetails }).from(customers).where(eq(customers.email, email));
  const touchFields = acquisition ? {
    ...(!existing?.firstTouchSource ? { firstTouchSource: acquisition.source, firstTouchDetails: acquisition.details, firstVisitAt: at ?? new Date() } : {}),
    lastTouchSource: acquisition.source, lastTouchDetails: acquisition.details,
  } : {};
  const [row] = await tx.insert(customers).values({ email, name, phone: c.phone ?? null, ...touchFields, ...(at ? { createdAt: at, updatedAt: at } : {}) })
    .onConflictDoUpdate({ target: customers.email, set: { name, updatedAt: new Date(), ...touchFields } })
    .returning({ id: customers.id });
  const firstTouch: TouchSnapshot = existing?.firstTouchSource
    ? { source: existing.firstTouchSource, details: (existing.firstTouchDetails ?? null) as TouchSnapshot["details"] }
    : acquisition ? { source: acquisition.source, details: acquisition.details ?? null } : { source: null, details: null };
  const lastTouch: TouchSnapshot = acquisition ? { source: acquisition.source, details: acquisition.details ?? null } : firstTouch;
  return { id: row!.id, firstTouch, lastTouch };
}

/**
 * The order → inventory transaction (docs/BUSINESS_LOGIC.md §2):
 * customer → lock stock → re-price → validate stock and discount → order + items (with snapshots and profit)
 * → SALE movements (or reservations) → discount usage → payment record → events, notifications, audit.
 * Any failure rolls back everything.
 */
export async function placeOrder(db: Db, input: PlaceOrderInput, actor: Actor = STOREFRONT_ACTOR) {
  if (actor !== STOREFRONT_ACTOR) assertCan(actor, "orders:write");
  const lines = normalizeLines(input.lines);
  const status = input.status ?? "pending";
  if (actor === STOREFRONT_ACTOR && status === "paid") throw new ValidationError("Storefront orders are confirmed by the payment provider, not the browser.");
  return db.transaction(async (tx) => {
    const at = input.placedAt ?? new Date();
    const channel = await loadChannel(tx, input.channel ?? "WEBSITE");
    const { id: customerId, firstTouch, lastTouch } = await upsertCustomer(tx, input.customer, input.placedAt, input.acquisition);
    const locked = await lockInventory(tx, lines.map((l) => l.variantId)); // lock first; everything read after is consistent
    const { loaded, problems } = await priceLines(tx, lines);
    if (problems.length) throw new InsufficientStockError(problems[0]!);
    const discount = input.discountCode ? await validateDiscount(tx, input.discountCode, loaded, customerId, at) : null;
    const subtotalForShipping = loaded.reduce((a, l) => a + l.unitPriceCents * l.quantity, 0);
    const shippingMethod = await loadShippingMethod(tx, input.shippingMethodId, { subtotalCents: subtotalForShipping, countryCode: input.shippingAddress?.country, region: input.shippingAddress?.state });
    const t = computeTotals(loaded, discount, channel, !!input.express, shippingMethod);

    const [order] = await tx.insert(orders).values({
      customerId, channelId: channel.id, ...statusFields(status),
      subtotalCents: t.subtotalCents, discountTotalCents: t.discountTotalCents, shippingTotalCents: t.shippingTotalCents, taxTotalCents: t.taxTotalCents, totalCents: t.totalCents,
      costTotalCents: t.costTotalCents, grossProfitCents: t.grossProfitCents, grossMargin: t.grossMargin,
      paymentFeeCents: t.paymentFeeCents, shippingCostCents: t.shippingCostCents,
      discountCode: discount?.code ?? null, expressShipping: !!input.express, shippingMethodId: shippingMethod?.id ?? null,
      shippingAddress: input.shippingAddress ?? null, billingAddress: input.billingAddress ?? input.shippingAddress ?? null, notes: input.notes ?? null,
      placedAt: at, paidAt: status === "paid" ? at : null, createdByUserId: actor.userId, createdAt: at, updatedAt: at,
      reservationExpiresAt: status === "pending" ? new Date(at.getTime() + STORE.reservationMinutes * 60_000) : null,
    }).returning();
    if (!order) throw new Error("Order insert failed");

    await tx.insert(orderItems).values(loaded.map((l, i) => ({
      orderId: order.id, productId: l.productId, variantId: l.variantId,
      productNameSnapshot: l.productName, skuSnapshot: l.sku, variantSnapshot: l.snapshot,
      quantity: l.quantity, unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, ...t.lineAmounts[i]!,
      personalization: l.personalization ?? null, createdAt: at,
    })));

    for (const l of loaded) {
      const row = locked.get(l.variantId)!;
      if (status === "paid") await applyMovement(tx, row, { variantId: l.variantId, quantity: -l.quantity, movementType: "SALE", referenceType: "order", referenceId: order.orderNumber, orderId: order.id, userId: actor.userId, notes: channel.name, at });
      else await reserve(tx, row, l.quantity);
    }
    if (discount && (t.discountTotalCents > 0 || discount.type === "free_shipping")) await consumeDiscount(tx, discount, order.id, customerId, t.discountTotalCents);

    // Phase 7 (brief §4-5, §8): an immutable per-order attribution snapshot, and funnel events — see
    // docs/PHASE_7_AUDIT.md for why this can't just read customers.last_touch_* later (it keeps changing
    // on future visits).
    let lastCampaignId: string | null = null;
    if (firstTouch.source || lastTouch.source) {
      const [firstCampaignId, lastId] = await Promise.all([
        resolveCampaignId(tx, firstTouch.details?.utmCampaign), resolveCampaignId(tx, lastTouch.details?.utmCampaign),
      ]);
      lastCampaignId = lastId;
      await tx.insert(marketingAttributions).values({
        orderId: order.id, customerId,
        firstTouchSource: firstTouch.source, firstTouchDetails: firstTouch.details, firstTouchCampaignId: firstCampaignId,
        lastTouchSource: lastTouch.source, lastTouchDetails: lastTouch.details, lastTouchCampaignId: lastCampaignId,
      });
      if (status === "pending" && channel.code === "WEBSITE") await recordOrderEvent(tx, "checkout_started", order.id, { campaignId: lastCampaignId, customerId });
    }

    await tx.insert(orderEvents).values([
      { orderId: order.id, status: "pending" as const, createdAt: at, userId: actor.userId },
      ...(status === "paid" ? [{ orderId: order.id, status: "paid" as const, createdAt: at, userId: actor.userId }] : []),
    ]);
    await tx.insert(payments).values({
      orderId: order.id, provider: input.paymentProvider ?? (channel.code === "WEBSITE" ? "stripe" : "manual"), providerRef: input.paymentRef ?? null,
      status: status === "paid" ? "succeeded" : "pending", amountCents: t.totalCents, feeCents: t.paymentFeeCents, createdAt: at,
    });
    if (status === "paid") {
      await announcePaid(tx, order, input.customer.name, channel.name);
      await earnPointsForOrder(tx, order);
      await recordOrderEvent(tx, "purchase_completed", order.id, { campaignId: lastCampaignId, customerId });
    }
    if (actor.userId) await audit(tx, actor, "Created order", "order", order.orderNumber, undefined, { channel: channel.code, totalCents: t.totalCents });
    return order;
  });
}

async function announcePaid(tx: Tx, o: Pick<OrderRow, "orderNumber" | "totalCents">, customerName: string, channelName: string) {
  const large = o.totalCents >= STORE.largeOrderCents;
  await notify(tx, large ? "large_order" : "new_order", `${large ? "Large order" : "New order"} ${o.orderNumber}`, `${formatMoney(o.totalCents)} from ${customerName}, ${channelName}`, o.orderNumber);
  await emit(tx, { type: "order.paid", orderNumber: o.orderNumber, totalCents: o.totalCents });
}

async function lockOrder(tx: Tx, orderId: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o) throw new NotFoundError("Order not found.");
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { o, items };
}

/** Payment confirmed (the Stripe webhook calls this). Idempotent: a repeated webhook changes nothing. */
export async function markOrderPaid(db: Db, orderId: string, payment: { providerRef?: string; feeCents?: number } = {}) {
  return db.transaction(async (tx) => {
    const { o, items } = await lockOrder(tx, orderId);
    if (o.status !== "pending") return { alreadyProcessed: true };
    const locked = await lockInventory(tx, items.map((i) => i.variantId));
    for (const i of items) await applyMovement(tx, locked.get(i.variantId)!, { variantId: i.variantId, quantity: -i.quantity, reservedDelta: -i.quantity, movementType: "SALE", referenceType: "order", referenceId: o.orderNumber, orderId: o.id });
    const now = new Date();
    await tx.update(orders).set({ ...statusFields("paid"), paidAt: now, ...(payment.feeCents != null ? { paymentFeeCents: payment.feeCents } : {}) }).where(eq(orders.id, o.id));
    await tx.update(payments).set({ status: "succeeded", providerRef: payment.providerRef ?? null, ...(payment.feeCents != null ? { feeCents: payment.feeCents } : {}) }).where(and(eq(payments.orderId, o.id), eq(payments.status, "pending")));
    await tx.insert(orderEvents).values({ orderId: o.id, status: "paid" });
    const [c] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, o.customerId));
    const [ch] = await tx.select({ name: salesChannels.name }).from(salesChannels).where(eq(salesChannels.id, o.channelId));
    await announcePaid(tx, o, c?.name ?? "", ch?.name ?? "");
    await earnPointsForOrder(tx, o);
    await markCartRecovered(tx, o.customerId, o.id);
    const [attr] = await tx.select({ campaignId: marketingAttributions.lastTouchCampaignId }).from(marketingAttributions).where(eq(marketingAttributions.orderId, o.id));
    await recordOrderEvent(tx, "purchase_completed", o.id, { campaignId: attr?.campaignId ?? null, customerId: o.customerId });
    return { alreadyProcessed: false };
  });
}

/** The card was declined. The order stays pending (the customer may retry) and staff are notified. */
export async function recordPaymentFailure(db: Db, orderId: string, reason: string) {
  await db.transaction(async (tx) => {
    const { o } = await lockOrder(tx, orderId);
    if (o.status !== "pending") return;
    await tx.update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, o.id));
    await tx.update(payments).set({ status: "failed" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "pending")));
    await notify(tx, "payment_failed", `Payment failed ${o.orderNumber}`, `${formatMoney(o.totalCents)}: ${reason}`, o.orderNumber);
  });
}

/**
 * Staff status change, enforced server-side.
 * Cancelling a pending order releases its reservation. Cancelling or refunding a paid order refunds the
 * revenue, returns the goods to stock (RETURN movements) unless restock=false, and updates the order's profit.
 */
export async function updateOrderStatus(db: Db, actor: Actor, orderId: string, next: OrderStatus, opts: { reason?: string; restock?: boolean } = {}) {
  assertCan(actor, "orders:write");
  if (next === "paid") { const r = await markOrderPaid(db, orderId); if (r.alreadyProcessed) throw new ValidationError("This order is already paid."); return; }
  return db.transaction(async (tx) => {
    const { o, items } = await lockOrder(tx, orderId);
    if (!TRANSITIONS[o.status].includes(next)) throw new ValidationError(`An order that is ${o.status} cannot become ${next}.`);
    const restock = opts.restock ?? true;
    const locked = await lockInventory(tx, items.map((i) => i.variantId));
    const set: Partial<typeof orders.$inferInsert> = statusFields(next, o);

    if (o.status === "pending" && next === "cancelled") {
      for (const i of items) await release(tx, locked.get(i.variantId)!, i.quantity);
    } else if (next === "cancelled" || next === "refunded") {
      if (restock) for (const i of items) await applyMovement(tx, locked.get(i.variantId)!, { variantId: i.variantId, quantity: i.quantity, movementType: "RETURN", referenceType: "refund", referenceId: o.orderNumber, orderId: o.id, userId: actor.userId, notes: opts.reason ?? (next === "cancelled" ? "Order cancelled" : "Refunded") });
      // Full refund of the revenue portion. Tax and shipping are pass-through and are refunded by the payment provider.
      const refund = o.subtotalCents - o.discountTotalCents;
      const cost = restock ? 0 : o.costTotalCents; // goods back on the shelf are no longer a cost of sale
      set.refundTotalCents = refund;
      set.costTotalCents = cost;
      set.grossProfitCents = o.subtotalCents - o.discountTotalCents - refund - cost;
      set.grossMargin = marginPct(set.grossProfitCents, o.subtotalCents - o.discountTotalCents - refund);
      const [p] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.orderId, o.id), eq(payments.status, "succeeded")));
      if (refund > 0) await tx.insert(refunds).values({ orderId: o.id, paymentId: p?.id ?? null, amountCents: refund, reason: opts.reason ?? next, restocked: restock, userId: actor.userId });
      await tx.update(payments).set({ status: "refunded" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "succeeded")));
      await notify(tx, "refund", `Refund issued ${o.orderNumber}`, `${formatMoney(refund)} refunded${restock ? ", items returned to stock" : ""}`, o.orderNumber);
      if (refund > 0) await reversePointsForRefund(tx, o, refund);
    }
    await tx.update(orders).set(set).where(eq(orders.id, o.id));
    await tx.insert(orderEvents).values({ orderId: o.id, status: next, note: opts.reason ?? null, userId: actor.userId });
    await audit(tx, actor, next === "refunded" ? "Refunded order" : "Changed order status", "order", o.orderNumber, { status: o.status }, { status: next, restock });
    await emit(tx, { type: "order.status", orderNumber: o.orderNumber, status: next });
  });
}
