import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { customerAddresses, orderEvents, orderItems, orders, packages, returnRequests } from "../db/schema";
import { canCustomerCancel } from "../orders/cancellation";
import { getReturnPolicy } from "../returns/service";
import { trackingUrlFor } from "../fulfillment/service";

export type OrderSummary = {
  id: string; orderNumber: string; placedAt: Date; status: string; paymentStatus: string; fulfillmentStatus: string;
  totalCents: number; itemCount: number;
};

/** A signed-in shopper's own orders (RLS would enforce this too if the browser queried Supabase directly;
 *  the server checks customerId explicitly because Drizzle connects as the database owner). */
export async function getCustomerOrders(db: DbOrTx, customerId: string): Promise<OrderSummary[]> {
  const rows = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, placedAt: orders.placedAt, status: orders.status,
    paymentStatus: orders.paymentStatus, fulfillmentStatus: orders.fulfillmentStatus, totalCents: orders.totalCents,
  }).from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.placedAt));
  if (!rows.length) return [];
  const items = await db.select({ orderId: orderItems.orderId, quantity: orderItems.quantity }).from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((o) => o.id)));
  const itemCounts = new Map<string, number>();
  for (const i of items) itemCounts.set(i.orderId, (itemCounts.get(i.orderId) ?? 0) + i.quantity);
  return rows.map((o) => ({ ...o, itemCount: itemCounts.get(o.id) ?? 0 }));
}

export type OrderDetail = OrderSummary & {
  subtotalCents: number; discountTotalCents: number; shippingTotalCents: number; taxTotalCents: number; refundTotalCents: number;
  discountCode: string | null; shippingAddress: Record<string, string> | null; billingAddress: Record<string, string> | null;
  trackingNumber: string | null; carrier: string | null;
  items: { id: string; productNameSnapshot: string; skuSnapshot: string; variantSnapshot: { material: string; size: string | null; color: string | null; gemstone: string | null; label: string }; quantity: number; unitPriceCents: number; lineTotalCents: number }[];
  timeline: { status: string; note: string | null; createdAt: Date }[];
  packages: { id: string; packageNumber: number; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; status: string; shippedAt: Date | null; deliveredAt: Date | null }[];
  canCancel: boolean;
  returnRequests: { id: string; status: string; requestedAt: Date }[];
  canRequestReturn: boolean;
};

export async function getCustomerOrder(db: DbOrTx, customerId: string, orderId: string): Promise<OrderDetail | null> {
  const [o] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)));
  if (!o) return null;
  return loadOrderDetail(db, o);
}

/** Used only by /checkout/success, reached with the order's random UUID right after payment — not
 *  gated on a signed-in session, since checkout doesn't require an account. Never look this up by the
 *  human-readable, sequential order number (ORD-10023): the UUID is what makes this safe to expose. */
export async function getOrderConfirmation(db: DbOrTx, orderId: string): Promise<OrderDetail | null> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return null;
  return loadOrderDetail(db, o);
}

async function loadOrderDetail(db: DbOrTx, o: typeof orders.$inferSelect): Promise<OrderDetail> {
  const [items, timeline, pkgs, returns, policy, canCancel] = await Promise.all([
    db.select({
      id: orderItems.id, productNameSnapshot: orderItems.productNameSnapshot, skuSnapshot: orderItems.skuSnapshot,
      variantSnapshot: orderItems.variantSnapshot, quantity: orderItems.quantity, unitPriceCents: orderItems.unitPriceCents, lineTotalCents: orderItems.lineTotalCents,
    }).from(orderItems).where(eq(orderItems.orderId, o.id)),
    db.select({ status: orderEvents.status, note: orderEvents.note, createdAt: orderEvents.createdAt })
      .from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(orderEvents.createdAt),
    db.select({ id: packages.id, packageNumber: packages.packageNumber, carrier: packages.carrier, trackingNumber: packages.trackingNumber, trackingUrl: packages.trackingUrl, status: packages.status, shippedAt: packages.shippedAt, deliveredAt: packages.deliveredAt })
      .from(packages).where(eq(packages.orderId, o.id)).orderBy(packages.packageNumber),
    db.select({ id: returnRequests.id, status: returnRequests.status, requestedAt: returnRequests.requestedAt }).from(returnRequests).where(eq(returnRequests.orderId, o.id)).orderBy(desc(returnRequests.requestedAt)),
    getReturnPolicy(db),
    canCustomerCancel(db, o.customerId, o.id),
  ]);
  const windowStart = o.paidAt ?? o.placedAt;
  const withinWindow = (Date.now() - new Date(windowStart).getTime()) / 86_400_000 <= policy.returnWindowDays;
  const canRequestReturn = (policy.refundEnabled || policy.exchangeEnabled) && withinWindow && (["delivered", "completed"] as string[]).includes(o.fulfillmentStatus);
  return {
    id: o.id, orderNumber: o.orderNumber, placedAt: o.placedAt, status: o.status, paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus,
    totalCents: o.totalCents, itemCount: items.reduce((a, i) => a + i.quantity, 0),
    subtotalCents: o.subtotalCents, discountTotalCents: o.discountTotalCents, shippingTotalCents: o.shippingTotalCents, taxTotalCents: o.taxTotalCents, refundTotalCents: o.refundTotalCents,
    discountCode: o.discountCode, shippingAddress: o.shippingAddress, billingAddress: o.billingAddress,
    trackingNumber: o.trackingNumber, carrier: o.carrier, items, timeline,
    packages: pkgs.map((p) => ({ ...p, trackingUrl: p.trackingUrl ?? trackingUrlFor(p.carrier, p.trackingNumber, p.trackingUrl) })),
    canCancel, returnRequests: returns, canRequestReturn,
  };
}

export async function getAddresses(db: DbOrTx, customerId: string) {
  return db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customerId)).orderBy(desc(customerAddresses.isDefault));
}

export type NewAddress = Omit<typeof customerAddresses.$inferInsert, "id" | "customerId" | "createdAt">;
export async function addAddress(db: DbOrTx, customerId: string, input: NewAddress) {
  if (input.isDefault) await db.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.customerId, customerId));
  const [row] = await db.insert(customerAddresses).values({ ...input, customerId }).returning();
  return row!;
}

export async function removeAddress(db: DbOrTx, customerId: string, addressId: string) {
  await db.delete(customerAddresses).where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.customerId, customerId)));
}
