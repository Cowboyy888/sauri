/**
 * Releases stock reservations from abandoned web checkouts (brief §30). The webhook handles the common
 * case directly (`checkout.session.expired` cancels that one order the moment Stripe expires it); this
 * sweep is the safety net for when a webhook never arrives — safe to call as often as you like, from
 * anywhere (checkout start, a cron hitting /api/cron/release-reservations, …).
 */
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import { SYSTEM_ACTOR } from "../auth/permissions";
import { updateOrderStatus } from "./service";

export async function releaseExpiredReservations(db: Db): Promise<{ released: number }> {
  const stale = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.status, "pending"), lt(orders.reservationExpiresAt, new Date())));
  for (const o of stale) {
    // Each is its own transaction; one already-processed or since-paid order (a race with the webhook)
    // must not stop the rest from being released.
    await updateOrderStatus(db, SYSTEM_ACTOR, o.id, "cancelled", { reason: "Reservation expired" }).catch(() => {});
  }
  return { released: stale.length };
}
