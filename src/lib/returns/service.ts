/**
 * Customer returns: request → review → (customer ships it back) → received → inspected → refunded
 * (brief §19–§25). See docs/RETURNS.md.
 *
 * Refunds always go through the existing `refundOrder()` (Phase 4) — this file only decides *how much*
 * and tags the resulting `refunds` row with the return it came from. Restocking always goes through the
 * existing `applyMovement()` (Phase 1) — this file only decides *whether* to (brief §24: never for a
 * damaged/defective/unsellable item).
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../db/client";
import {
  categories, customers, orderItems, orders, productVariants, products, returnEvents, returnInspections, returnItems, returnRequests, settings,
} from "../db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit, notify } from "../audit";
import { emailProvider, returnApprovedEmail, returnRejectedEmail, returnRequestedEmail } from "../email/provider";
import { refundOrder } from "../orders/refunds";
import { lockInventory, applyMovement } from "../inventory/service";
import { DEFAULT_RETURN_POLICY } from "../db/reference-data";

type ReturnRow = typeof returnRequests.$inferSelect;
export type ReturnStatusValue = ReturnRow["status"];

export const RETURN_TRANSITIONS: Record<ReturnStatusValue, ReturnStatusValue[]> = {
  requested: ["under_review", "approved", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["return_shipped", "rejected"],
  return_shipped: ["received"],
  received: ["inspecting"],
  inspecting: ["approved_for_refund", "rejected"],
  approved_for_refund: ["refunded"],
  rejected: ["closed"],
  refunded: ["closed"],
  closed: [],
};

async function getReturnPolicy(db: Db) {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "returns"));
  return { ...DEFAULT_RETURN_POLICY, ...(row?.value as Partial<typeof DEFAULT_RETURN_POLICY> | undefined) };
}
export { getReturnPolicy };

/** Admin policy configuration (brief §26) — every field configurable, never hardcoded. */
export async function setReturnPolicy(db: Db, actor: Actor, patch: Partial<typeof DEFAULT_RETURN_POLICY>) {
  assertCan(actor, "settings:write");
  const before = await getReturnPolicy(db);
  const next = { ...before, ...patch };
  if (!Number.isInteger(next.returnWindowDays) || next.returnWindowDays < 0) throw new ValidationError("Return window must be zero or more days.");
  await db.insert(settings).values({ key: "returns", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Updated return policy", "settings", "returns", before, next);
  return next;
}

/** What the return request form shows per line: how many units are still eligible to return, and why
 *  the rest (if any) aren't — a final-sale tag, a category the policy excludes, or none left to request. */
export async function getReturnEligibleItems(db: Db, orderId: string) {
  const policy = await getReturnPolicy(db);
  const lines = await db.select({
    id: orderItems.id, productNameSnapshot: orderItems.productNameSnapshot, skuSnapshot: orderItems.skuSnapshot, variantSnapshot: orderItems.variantSnapshot,
    quantity: orderItems.quantity, variantId: orderItems.variantId,
  }).from(orderItems).where(eq(orderItems.orderId, orderId));
  if (!lines.length) return [];
  const variantIds = lines.map((l) => l.variantId);
  const meta = await db.select({ variantId: productVariants.id, tags: products.tags, categorySlug: categories.slug })
    .from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).innerJoin(categories, eq(categories.id, products.categoryId))
    .where(inArray(productVariants.id, variantIds));
  const metaByVariant = new Map(meta.map((m) => [m.variantId, m]));
  const already = await requestedQuantities(db, lines.map((l) => l.id));

  return lines.map((l) => {
    const m = metaByVariant.get(l.variantId);
    const finalSale = !!m && m.tags.some((t) => policy.finalSaleTags.includes(t));
    const categoryExcluded = !!m && policy.eligibleCategorySlugs != null && !policy.eligibleCategorySlugs.includes(m.categorySlug);
    const remaining = l.quantity - (already.get(l.id) ?? 0);
    const eligible = !finalSale && !categoryExcluded && remaining > 0;
    return {
      orderItemId: l.id, productName: l.productNameSnapshot, sku: l.skuSnapshot, variant: (l.variantSnapshot as { label: string }).label, remaining: Math.max(0, remaining),
      eligible, reason: finalSale ? "Final sale — not eligible for return" : categoryExcluded ? "This category isn't eligible for return" : remaining <= 0 ? "Already requested" : null,
    };
  });
}

/* ------------------------------------------------------------ customer request */
export type NewReturnItem = {
  orderItemId: string; quantity: number; reason: (typeof returnItems.$inferInsert)["reason"];
  description?: string; photoUrls?: string[]; exchangeRequested?: boolean; replacementVariantId?: string | null;
};

export async function createReturnRequest(db: Db, customerId: string, orderId: string, items: NewReturnItem[], customerNotes?: string) {
  if (!items.length) throw new ValidationError("Select at least one item to return.");
  const policy = await getReturnPolicy(db);
  if (!policy.refundEnabled) throw new ValidationError("Returns are not currently accepted.");

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new NotFoundError("Order not found.");
    if (order.customerId !== customerId) throw new ForbiddenError("This order does not belong to you.");
    if (!(["delivered", "completed"] as string[]).includes(order.fulfillmentStatus)) throw new ValidationError("This order hasn't been delivered yet.");

    const deliveredEvent = order.fulfillmentStatus; // delivered_at isn't tracked order-wide (multi-package); use paidAt-based window as the practical baseline
    void deliveredEvent;
    const windowStart = order.paidAt ?? order.placedAt;
    const daysSince = (Date.now() - new Date(windowStart).getTime()) / 86_400_000;
    if (daysSince > policy.returnWindowDays) throw new ValidationError(`The return window (${policy.returnWindowDays} days) for this order has closed.`);

    const orderItemIds = items.map((i) => i.orderItemId);
    const lines = await tx.select().from(orderItems).where(and(eq(orderItems.orderId, orderId), inArray(orderItems.id, orderItemIds)));
    if (lines.length !== orderItemIds.length) throw new ValidationError("One of these items doesn't belong to this order.");

    const alreadyRequested = await requestedQuantities(tx, orderItemIds);
    for (const i of items) {
      const line = lines.find((l) => l.id === i.orderItemId)!;
      const remaining = line.quantity - (alreadyRequested.get(i.orderItemId) ?? 0);
      if (!Number.isInteger(i.quantity) || i.quantity <= 0 || i.quantity > remaining) throw new ValidationError(`You can return at most ${remaining} unit(s) of ${line.productNameSnapshot}.`);
    }

    const [rr] = await tx.insert(returnRequests).values({ orderId, customerId, customerNotes: customerNotes?.trim() || null }).returning();
    await tx.insert(returnItems).values(items.map((i) => ({
      returnRequestId: rr!.id, orderItemId: i.orderItemId, quantity: i.quantity, reason: i.reason, description: i.description?.trim() || null,
      photoUrls: i.photoUrls ?? [], exchangeRequested: i.exchangeRequested ?? false, replacementVariantId: i.replacementVariantId ?? null,
    })));
    await tx.insert(returnEvents).values({ returnRequestId: rr!.id, status: "requested" });
    await notify(tx, "return_requested", `Return requested — ${order.orderNumber}`, `${items.length} item(s)`, order.orderNumber);
    const [c] = await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, customerId));
    if (c) await emailProvider.send(returnRequestedEmail({ orderNumber: order.orderNumber, email: c.email }));
    return rr!;
  });
}

async function requestedQuantities(tx: DbOrTx, orderItemIds: string[]): Promise<Map<string, number>> {
  if (!orderItemIds.length) return new Map();
  const rows = await tx.select({ orderItemId: returnItems.orderItemId, quantity: returnItems.quantity })
    .from(returnItems).innerJoin(returnRequests, eq(returnRequests.id, returnItems.returnRequestId))
    .where(and(inArray(returnItems.orderItemId, orderItemIds), ne(returnRequests.status, "rejected")));
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.orderItemId, (out.get(r.orderItemId) ?? 0) + r.quantity);
  return out;
}

/* --------------------------------------------------------------------- staff */
async function requireReturn(tx: Tx, id: string) {
  const [rr] = await tx.select().from(returnRequests).where(eq(returnRequests.id, id)).for("update");
  if (!rr) throw new NotFoundError("Return request not found.");
  return rr;
}

export async function updateReturnStatus(db: Db, actor: Actor, returnRequestId: string, next: ReturnStatusValue, note?: string) {
  assertCan(actor, "orders:write");
  return db.transaction(async (tx) => {
    const rr = await requireReturn(tx, returnRequestId);
    if (!RETURN_TRANSITIONS[rr.status].includes(next)) throw new ValidationError(`A return that is "${rr.status}" cannot move to "${next}".`);
    await tx.update(returnRequests).set({ status: next }).where(eq(returnRequests.id, rr.id));
    await tx.insert(returnEvents).values({ returnRequestId: rr.id, status: next, note: note ?? null, userId: actor.userId });
    await audit(tx, actor, "Changed return status", "return_request", rr.id, { status: rr.status }, { status: next });

    const [order] = await tx.select({ orderNumber: orders.orderNumber, customerId: orders.customerId }).from(orders).where(eq(orders.id, rr.orderId));
    const [c] = order ? await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, order.customerId)) : [null];
    if (next === "approved" && c && order) await emailProvider.send(returnApprovedEmail({ orderNumber: order.orderNumber, email: c.email }));
    if (next === "rejected" && c && order) await emailProvider.send(returnRejectedEmail({ orderNumber: order.orderNumber, email: c.email, reason: note }));
    if (next === "received" && order) await notify(tx, "return_received", `Return received — ${order.orderNumber}`, "", order.orderNumber);
    if (next === "inspecting") {
      // Moving into inspection is also where the physical goods land in the RETURNS location conceptually —
      // no inventory movement yet, since nothing is restocked until a per-item disposition says so.
    }
  });
}

/** "Request More Information" — a note on the return, not a status change (the return stays wherever it
 *  was). Distinct from `updateReturnStatus`, which only ever moves the return along its state machine. */
export async function requestReturnInfo(db: Db, actor: Actor, returnRequestId: string, note: string) {
  assertCan(actor, "orders:write");
  const clean = note.trim();
  if (!clean) throw new ValidationError("Say what information is needed.");
  return db.transaction(async (tx) => {
    const rr = await requireReturn(tx, returnRequestId);
    await tx.insert(returnEvents).values({ returnRequestId: rr.id, status: rr.status, note: `Requested more information: ${clean}`, userId: actor.userId });
    await audit(tx, actor, "Requested more information on return", "return_request", rr.id, undefined, { note: clean });
  });
}

/** Sets the tracking info a customer (or staff, on their behalf) provided for shipping the item back. */
export async function setReturnShipping(db: Db, actor: Actor, returnRequestId: string, input: { trackingNumber?: string; carrier?: string }) {
  assertCan(actor, "orders:write");
  await db.update(returnRequests).set({ returnTrackingNumber: input.trackingNumber, returnCarrier: input.carrier }).where(eq(returnRequests.id, returnRequestId));
  await audit(db, actor, "Added return tracking", "return_request", returnRequestId, undefined, input);
}

/* ---------------------------------------------------------------- inspection */
export type InspectionInput = {
  condition: (typeof returnInspections.$inferInsert)["condition"]; disposition: (typeof returnInspections.$inferInsert)["disposition"];
  notes?: string; photoUrls?: string[];
};

/**
 * Records the inspection and, only for a RESTOCK disposition, restocks it (brief §24) — a RETURN movement
 * via the existing `applyMovement`, referencing this return request. Every other disposition (repair,
 * damaged, dispose, return_to_customer) deliberately writes no inventory movement at all: the unit was
 * already deducted at sale, and not reversing that deduction *is* "not increasing sellable inventory" —
 * there's no zero-quantity movement to write (the ledger's own check constraint forbids one), and there
 * shouldn't be: nothing about stock actually changed.
 */
export async function recordInspection(db: Db, actor: Actor, returnItemId: string, input: InspectionInput) {
  assertCan(actor, "inventory:write");
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(returnItems).where(eq(returnItems.id, returnItemId)).for("update");
    if (!item) throw new NotFoundError("Return item not found.");
    const [existing] = await tx.select({ id: returnInspections.id }).from(returnInspections).where(eq(returnInspections.returnItemId, returnItemId));
    if (existing) throw new ValidationError("This item has already been inspected.");

    await tx.insert(returnInspections).values({
      returnItemId, condition: input.condition, disposition: input.disposition, notes: input.notes ?? null,
      photoUrls: input.photoUrls ?? [], inspectedByUserId: actor.userId,
    });

    if (input.disposition === "restock") {
      const [oi] = await tx.select({ variantId: orderItems.variantId, orderId: orderItems.orderId }).from(orderItems).where(eq(orderItems.id, item.orderItemId));
      if (oi) {
        const locked = await lockInventory(tx, [oi.variantId]);
        const row = locked.get(oi.variantId);
        if (row) {
          await applyMovement(tx, row, {
            variantId: oi.variantId, quantity: item.quantity, movementType: "RETURN",
            referenceType: "return_request", referenceId: item.returnRequestId, userId: actor.userId,
            notes: `Restocked from return, condition: ${input.condition}`,
          });
        }
      }
    }
    await audit(tx, actor, "Recorded return inspection", "return_item", returnItemId, undefined, { condition: input.condition, disposition: input.disposition });
  });
}

/** True once every item on the return request has a recorded inspection. */
export async function isFullyInspected(db: Db, returnRequestId: string): Promise<boolean> {
  const items = await db.select({ id: returnItems.id }).from(returnItems).where(eq(returnItems.returnRequestId, returnRequestId));
  if (!items.length) return false;
  const inspected = await db.select({ id: returnInspections.id }).from(returnInspections).where(inArray(returnInspections.returnItemId, items.map((i) => i.id)));
  return inspected.length === items.length;
}

/* -------------------------------------------------------------------- refund */
/** Refunds the merchandise value of every item on the return (its line-total share, proportional to
 *  quantity — the same "refund the merchandise, tax/shipping are pass-through" rule Phase 4's full-refund
 *  path already uses). Ties the resulting `refunds` row back to this return request. */
export async function refundReturn(db: Db, actor: Actor, returnRequestId: string) {
  assertCan(actor, "orders:write");
  const [rr] = await db.select().from(returnRequests).where(eq(returnRequests.id, returnRequestId));
  if (!rr) throw new NotFoundError("Return request not found.");
  if (rr.status !== "approved_for_refund") throw new ValidationError(`A return that is "${rr.status}" is not ready to be refunded.`);

  const items = await db.select({ quantity: returnItems.quantity, orderItemId: returnItems.orderItemId }).from(returnItems).where(eq(returnItems.returnRequestId, returnRequestId));
  const orderItemIds = items.map((i) => i.orderItemId);
  const lines = await db.select({ id: orderItems.id, quantity: orderItems.quantity, lineTotalCents: orderItems.lineTotalCents }).from(orderItems).where(inArray(orderItems.id, orderItemIds));
  let amountCents = 0;
  for (const i of items) {
    const line = lines.find((l) => l.id === i.orderItemId);
    if (!line) continue;
    amountCents += Math.round((line.lineTotalCents / line.quantity) * i.quantity);
  }
  if (amountCents <= 0) throw new ValidationError("Nothing to refund for this return.");

  const result = await refundOrder(db, actor, rr.orderId, { amountCents, reason: `Return ${rr.id}`, returnRequestId: rr.id });
  await updateReturnStatus(db, actor, returnRequestId, "refunded");
  return { ...result, amountCents };
}

export async function closeReturn(db: Db, actor: Actor, returnRequestId: string) {
  await updateReturnStatus(db, actor, returnRequestId, "closed");
}

/* --------------------------------------------------------------- replacement variant validation */
export async function assertVariantExists(db: Db, variantId: string) {
  const [v] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, variantId));
  if (!v) throw new ValidationError("Chosen replacement variant does not exist.");
}
