/**
 * Customer-initiated cancellation (brief §18). This is its own authorization boundary — it checks order
 * ownership and eligibility itself, then drives the exact same `updateOrderStatus("cancelled")` an admin
 * cancellation uses (same reservation release / restock / refund / audit trail), via SYSTEM_ACTOR so it
 * isn't blocked by the staff-only `orders:write` permission a customer obviously doesn't have.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { SYSTEM_ACTOR } from "../auth/permissions";
import { updateOrderStatus, type OrderStatus } from "./service";

/** Statuses a customer may self-cancel from — always before anything has shipped. */
const CUSTOMER_CANCELLABLE: OrderStatus[] = ["pending", "paid", "processing"];

export async function canCustomerCancel(db: Db, customerId: string, orderId: string): Promise<boolean> {
  const [o] = await db.select({ customerId: orders.customerId, status: orders.status }).from(orders).where(eq(orders.id, orderId));
  return !!o && o.customerId === customerId && CUSTOMER_CANCELLABLE.includes(o.status);
}

export async function requestCancellation(db: Db, customerId: string, orderId: string, reason?: string) {
  const [o] = await db.select({ customerId: orders.customerId, status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (!o) throw new NotFoundError("Order not found.");
  if (o.customerId !== customerId) throw new ForbiddenError("This order does not belong to you.");
  if (!CUSTOMER_CANCELLABLE.includes(o.status)) throw new ValidationError(`An order that is ${o.status} can no longer be cancelled online — contact support.`);
  await updateOrderStatus(db, SYSTEM_ACTOR, orderId, "cancelled", { reason: reason?.trim() || "Cancelled by customer" });
}
