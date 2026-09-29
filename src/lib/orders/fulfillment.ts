/** Small, permission-checked order edits that aren't a status transition: tracking info and internal
 *  notes (brief §18). Both just update the row and write an audit entry — no inventory or money involved. */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";

export async function setTracking(db: Db, actor: Actor, orderId: string, input: { trackingNumber: string; carrier?: string | null }) {
  assertCan(actor, "orders:write");
  const trackingNumber = input.trackingNumber.trim();
  if (!trackingNumber) throw new ValidationError("Enter a tracking number.");
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ trackingNumber: orders.trackingNumber, carrier: orders.carrier, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, orderId));
    if (!before) throw new NotFoundError("Order not found.");
    await tx.update(orders).set({ trackingNumber, carrier: input.carrier?.trim() || null }).where(eq(orders.id, orderId));
    await audit(tx, actor, "Added tracking number", "order", before.orderNumber, { trackingNumber: before.trackingNumber, carrier: before.carrier }, { trackingNumber, carrier: input.carrier ?? null });
  });
}

export async function addOrderNote(db: Db, actor: Actor, orderId: string, note: string) {
  assertCan(actor, "orders:write");
  const clean = note.trim().slice(0, 2000);
  if (!clean) throw new ValidationError("Enter a note.");
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ internalNotes: orders.internalNotes, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, orderId));
    if (!before) throw new NotFoundError("Order not found.");
    const stamped = `[${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${actor.name}] ${clean}`;
    const next = before.internalNotes ? `${before.internalNotes}\n${stamped}` : stamped;
    await tx.update(orders).set({ internalNotes: next }).where(eq(orders.id, orderId));
    await audit(tx, actor, "Added order note", "order", before.orderNumber, undefined, { note: clean });
  });
}
