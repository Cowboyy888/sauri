/**
 * Fulfillment: the operational stages between a paid order and a shipped one (brief §2), plus packages,
 * picking, and delivery. See docs/FULFILLMENT.md.
 *
 * `orders.fulfillment_status` has two kinds of transition:
 *  - a linear staff checklist before anything ships (processing → picking → packing → ready_to_ship),
 *    driven by `advanceFulfillmentStage()`;
 *  - a rollup of package shipping statuses once packages exist (partially_shipped → shipped → in_transit
 *    → delivered), recomputed by `recomputeOrderFulfillmentStatus()` every time a package's status changes.
 * `orders.status` (the lifecycle dimension, unchanged from Phase 1) is kept in sync at the two milestones
 * it already cared about — shipped and delivered — without reusing `updateOrderStatus()`'s hardcoded
 * statusFields() mapping, which predates this finer-grained model and would overwrite it.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import {
  customers, fulfillmentEvents, fulfillmentItems, orderEvents, orderItems, orders, packageItems, packages, shippingEvents,
} from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit, emit, notify } from "../audit";
import { TRANSITIONS, type OrderStatus } from "../orders/service";
import { emailProvider, deliveryConfirmationEmail, shippingConfirmationEmail } from "../email/provider";

const sqlCount = () => sql<number>`count(*)::int`;

type FulfillmentRow = typeof orders.$inferSelect;
export type FulfillmentStatus = FulfillmentRow["fulfillmentStatus"];
export type ShipmentStatus = typeof packages.$inferSelect["status"];

/** The pre-shipment checklist (brief §2, §4). Each stage has exactly one valid next stage, so a jump like
 *  "processing → ready_to_ship" (skipping picking/packing) or "delivered → picking" is rejected outright. */
export const STAGE_TRANSITIONS: Partial<Record<FulfillmentStatus, FulfillmentStatus>> = {
  unfulfilled: "processing",
  processing: "picking",
  picking: "packing",
  packing: "ready_to_ship",
};

const SHIPPED_OR_BEYOND: ShipmentStatus[] = ["shipped", "in_transit", "out_for_delivery", "delivered"];
const STATUS_RANK: Record<ShipmentStatus, number> = { label_created: 0, ready_to_ship: 0, shipped: 1, in_transit: 2, out_for_delivery: 2, delivered: 3, delivery_failed: 1, return_to_sender: 1 };
const RANK_TO_ORDER_STATUS: Record<number, FulfillmentStatus> = { 1: "shipped", 2: "in_transit", 3: "delivered" };

async function requireOrder(tx: Tx, orderId: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o) throw new NotFoundError("Order not found.");
  return o;
}

/** Moves the order through processing → picking → packing → ready_to_ship, one stage at a time. */
export async function advanceFulfillmentStage(db: Db, actor: Actor, orderId: string, next: FulfillmentStatus, notes?: string) {
  assertCan(actor, "inventory:write");
  return db.transaction(async (tx) => {
    const o = await requireOrder(tx, orderId);
    if (!(["paid", "processing"] as OrderStatus[]).includes(o.status)) throw new ValidationError(`An order that is ${o.status} cannot be moved through fulfillment.`);
    if (STAGE_TRANSITIONS[o.fulfillmentStatus] !== next) throw new ValidationError(`An order in "${o.fulfillmentStatus}" cannot move to "${next}".`);
    await tx.update(orders).set({ fulfillmentStatus: next }).where(eq(orders.id, o.id));
    // The first stage entered also moves the lifecycle status from "paid" to "processing" (unchanged Phase 1 meaning).
    if (o.status === "paid" && TRANSITIONS.paid.includes("processing")) {
      await tx.update(orders).set({ status: "processing" }).where(eq(orders.id, o.id));
      await tx.insert(orderEvents).values({ orderId: o.id, status: "processing", userId: actor.userId });
    }
    await tx.insert(fulfillmentEvents).values({ orderId: o.id, status: next, note: notes ?? null, userId: actor.userId });
    await audit(tx, actor, "Changed fulfillment stage", "order", o.orderNumber, { fulfillmentStatus: o.fulfillmentStatus }, { fulfillmentStatus: next });
    await emit(tx, { type: "order.status", orderNumber: o.orderNumber, status: next });
    if (next === "processing") {
      // Ensure a picking row exists for every line, created lazily so orders placed before Phase 5 still work.
      const items = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, o.id));
      for (const i of items) await tx.insert(fulfillmentItems).values({ orderItemId: i.id }).onConflictDoNothing();
      await notify(tx, "ready_for_fulfillment", `Ready for fulfillment — ${o.orderNumber}`, "", o.orderNumber);
    }
  });
}

/** Marks one order line's pick outcome. An order is only fully picked once every line is PICKED — the
 *  UI (and `packing` readiness) is expected to check this before offering "Start Packing". */
export async function setPickStatus(db: Db, actor: Actor, orderItemId: string, status: "picked" | "missing" | "damaged", pickedQuantity?: number) {
  assertCan(actor, "inventory:write");
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(fulfillmentItems).where(eq(fulfillmentItems.orderItemId, orderItemId)).for("update");
    if (!item) throw new NotFoundError("This line has not started fulfillment yet.");
    const [oi] = await tx.select({ quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.id, orderItemId));
    const qty = pickedQuantity ?? (status === "picked" ? oi!.quantity : 0);
    await tx.update(fulfillmentItems).set({ pickStatus: status, pickedQuantity: qty }).where(eq(fulfillmentItems.id, item.id));
  });
}

export async function isFullyPicked(db: Db, orderId: string): Promise<boolean> {
  const items = await db.select({ pickStatus: fulfillmentItems.pickStatus, pickedQuantity: fulfillmentItems.pickedQuantity, quantity: orderItems.quantity })
    .from(fulfillmentItems).innerJoin(orderItems, eq(orderItems.id, fulfillmentItems.orderItemId)).where(eq(orderItems.orderId, orderId));
  return items.length > 0 && items.every((i) => i.pickStatus === "picked" && i.pickedQuantity >= i.quantity);
}

/* ------------------------------------------------------------------ packages */
export type NewPackageInput = {
  items: { orderItemId: string; quantity: number }[];
  weightGrams?: number; lengthMm?: number; widthMm?: number; heightMm?: number;
  carrier?: string; service?: string; trackingNumber?: string; trackingUrl?: string; labelUrl?: string;
};

/** "Create Shipment" (brief §4, §8). Multiple packages per order are supported — each covers some subset
 *  of the order's lines and quantities (brief §40). */
export async function createPackage(db: Db, actor: Actor, orderId: string, input: NewPackageInput) {
  assertCan(actor, "inventory:write");
  if (!input.items.length) throw new ValidationError("Add at least one item to the package.");
  return db.transaction(async (tx) => {
    const o = await requireOrder(tx, orderId);
    if (!(["ready_to_ship", "partially_shipped"] as FulfillmentStatus[]).includes(o.fulfillmentStatus)) {
      throw new ValidationError(`An order that is "${o.fulfillmentStatus}" is not ready to ship.`);
    }
    const orderItemIds = input.items.map((i) => i.orderItemId);
    const lines = await tx.select().from(orderItems).where(and(eq(orderItems.orderId, o.id), inArray(orderItems.id, orderItemIds)));
    if (lines.length !== orderItemIds.length) throw new ValidationError("One of these items doesn't belong to this order.");

    // Never pack more of a line than was ordered minus what's already in another package.
    const alreadyPacked = await packedQuantities(tx, o.id);
    for (const i of input.items) {
      const line = lines.find((l) => l.id === i.orderItemId)!;
      const remaining = line.quantity - (alreadyPacked.get(i.orderItemId) ?? 0);
      if (i.quantity <= 0 || i.quantity > remaining) throw new ValidationError(`Only ${remaining} unit(s) of ${line.productNameSnapshot} remain to be packaged.`);
    }

    const [countRow] = await tx.select({ n: sqlCount() }).from(packages).where(eq(packages.orderId, o.id));
    const [pkg] = await tx.insert(packages).values({
      orderId: o.id, packageNumber: countRow!.n + 1, weightGrams: input.weightGrams, lengthMm: input.lengthMm, widthMm: input.widthMm, heightMm: input.heightMm,
      carrier: input.carrier, service: input.service, trackingNumber: input.trackingNumber, trackingUrl: input.trackingUrl, labelUrl: input.labelUrl,
      status: "label_created",
    }).returning();
    await tx.insert(packageItems).values(input.items.map((i) => ({ packageId: pkg!.id, orderItemId: i.orderItemId, quantity: i.quantity })));
    await tx.insert(shippingEvents).values({ packageId: pkg!.id, status: "label_created", userId: actor.userId });
    await audit(tx, actor, "Created shipment", "order", o.orderNumber, undefined, { packageNumber: pkg!.packageNumber, carrier: input.carrier, trackingNumber: input.trackingNumber });
    return pkg!;
  });
}

async function packedQuantities(tx: Tx, orderId: string): Promise<Map<string, number>> {
  const rows = await tx.select({ orderItemId: packageItems.orderItemId, quantity: packageItems.quantity })
    .from(packageItems).innerJoin(packages, eq(packages.id, packageItems.packageId)).where(eq(packages.orderId, orderId));
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.orderItemId, (out.get(r.orderItemId) ?? 0) + r.quantity);
  return out;
}

/** Generates a carrier tracking URL for well-known carriers; otherwise the admin-entered custom URL. */
export function trackingUrlFor(carrier: string | null, trackingNumber: string | null, customUrl?: string | null): string | null {
  if (customUrl) return customUrl;
  if (!carrier || !trackingNumber) return null;
  const c = carrier.trim().toLowerCase();
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  if (c.includes("dhl")) return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
  return null;
}

/** Any package status change (brief §10, §11): updates the package, its own timeline, and rolls the
 *  change up into the order's fulfillment_status and — at shipped/delivered — the lifecycle status too.
 *  Customer emails (brief §13, §14) fire only on the actual transition into shipped/delivered, guarded
 *  by comparing against the package's *previous* status — calling this again with the same status is a
 *  no-op for notifications (idempotent, brief §38), even though the status write itself is harmless either way. */
export async function setPackageStatus(db: Db, actor: Actor, packageId: string, status: ShipmentStatus, note?: string) {
  assertCan(actor, "inventory:write");
  return db.transaction(async (tx) => {
    const [pkg] = await tx.select().from(packages).where(eq(packages.id, packageId)).for("update");
    if (!pkg) throw new NotFoundError("Package not found.");
    const wasAlready = pkg.status === status;
    const now = new Date();
    await tx.update(packages).set({
      status, shippedAt: status === "shipped" && !pkg.shippedAt ? now : pkg.shippedAt, deliveredAt: status === "delivered" ? now : pkg.deliveredAt,
    }).where(eq(packages.id, pkg.id));
    await tx.insert(shippingEvents).values({ packageId: pkg.id, status, note: note ?? null, userId: actor.userId });

    const o = await requireOrder(tx, pkg.orderId);
    await recomputeOrderFulfillmentStatus(tx, o, actor);

    if (!wasAlready && (status === "shipped" || status === "delivered")) {
      const [c] = await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, o.customerId));
      if (c) {
        const trackingUrl = trackingUrlFor(pkg.carrier, pkg.trackingNumber, pkg.trackingUrl);
        if (status === "shipped" && pkg.trackingNumber) {
          await emailProvider.send(shippingConfirmationEmail({ orderNumber: o.orderNumber, email: c.email, trackingNumber: pkg.trackingNumber, carrier: pkg.carrier, trackingUrl }));
        } else if (status === "delivered") {
          await emailProvider.send(deliveryConfirmationEmail({ orderNumber: o.orderNumber, email: c.email }));
        }
      }
    }
    if (!wasAlready && status === "delivery_failed") await notify(tx, "delivery_failed", `Delivery failed — ${o.orderNumber}`, `Package ${pkg.packageNumber}${note ? `: ${note}` : ""}`, o.orderNumber);
    await audit(tx, actor, "Changed shipping status", "package", pkg.id, { status: pkg.status }, { status });
  });
}

/** Recomputes `orders.fulfillment_status` from its packages' statuses. Called after any package status
 *  change; safe to call redundantly (it's a pure function of current state, not an increment). */
export async function recomputeOrderFulfillmentStatus(tx: Tx, o: FulfillmentRow, actor: Actor) {
  const items = await tx.select({ id: orderItems.id, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, o.id));
  const pkgs = await tx.select().from(packages).where(eq(packages.orderId, o.id));
  const shippedQtyByItem = new Map<string, number>();
  for (const pkg of pkgs) {
    if (!SHIPPED_OR_BEYOND.includes(pkg.status)) continue;
    const lines = await tx.select().from(packageItems).where(eq(packageItems.packageId, pkg.id));
    for (const l of lines) shippedQtyByItem.set(l.orderItemId, (shippedQtyByItem.get(l.orderItemId) ?? 0) + l.quantity);
  }
  const shippedPkgs = pkgs.filter((p) => SHIPPED_OR_BEYOND.includes(p.status));
  if (!shippedPkgs.length) return; // nothing has shipped yet — leave the pre-ship stage alone

  const fullyShipped = items.every((i) => (shippedQtyByItem.get(i.id) ?? 0) >= i.quantity);
  let next: FulfillmentStatus;
  if (!fullyShipped) {
    next = "partially_shipped";
  } else {
    const minRank = Math.min(...shippedPkgs.map((p) => STATUS_RANK[p.status]));
    next = RANK_TO_ORDER_STATUS[minRank] ?? "shipped";
  }
  if (next === o.fulfillmentStatus) return;

  await tx.update(orders).set({ fulfillmentStatus: next }).where(eq(orders.id, o.id));
  await tx.insert(fulfillmentEvents).values({ orderId: o.id, status: next, userId: actor.userId });
  // Sync the lifecycle dimension at its two Phase-1 milestones only — never through statusFields(), which
  // would overwrite this finer-grained status with its own coarse "shipped"/"delivered" mapping.
  if ((next === "shipped" || next === "delivered") && TRANSITIONS[o.status]?.includes(next)) {
    await tx.update(orders).set({ status: next, paidAt: o.paidAt }).where(eq(orders.id, o.id));
    await tx.insert(orderEvents).values({ orderId: o.id, status: next, userId: actor.userId });
  }
}

/** Staff can mark a delivered order "completed" once there's nothing left to do (e.g. the return window
 *  has closed). Manual, not time-driven — see docs/FULFILLMENT.md for why. */
export async function markCompleted(db: Db, actor: Actor, orderId: string) {
  assertCan(actor, "orders:write");
  return db.transaction(async (tx) => {
    const o = await requireOrder(tx, orderId);
    if (o.fulfillmentStatus !== "delivered") throw new ValidationError(`An order that is "${o.fulfillmentStatus}" cannot be marked completed.`);
    await tx.update(orders).set({ fulfillmentStatus: "completed" }).where(eq(orders.id, o.id));
    await tx.insert(fulfillmentEvents).values({ orderId: o.id, status: "completed", userId: actor.userId });
    await audit(tx, actor, "Marked order completed", "order", o.orderNumber, { fulfillmentStatus: "delivered" }, { fulfillmentStatus: "completed" });
  });
}
