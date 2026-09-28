import { sql } from "drizzle-orm";
import type { DbOrTx } from "./db/client";
import { auditLogs, notifications } from "./db/schema";
import type { Actor } from "./auth/permissions";

export async function audit(tx: DbOrTx, actor: Actor, action: string, entity: string, entityId: string | null, oldValue?: unknown, newValue?: unknown) {
  await tx.insert(auditLogs).values({
    userId: actor.userId, actor: actor.name, action, entity, entityId,
    oldValue: oldValue === undefined ? null : oldValue, newValue: newValue === undefined ? null : newValue,
  });
}

type NotificationType = typeof notifications.$inferInsert["type"];
export async function notify(tx: DbOrTx, type: NotificationType, title: string, body = "", reference: string | null = null) {
  await tx.insert(notifications).values({ type, title, body, reference });
}

export const EVENTS_CHANNEL = "sauri_events";
export type BusinessEvent =
  | { type: "order.paid"; orderNumber: string; totalCents: number }
  | { type: "order.status"; orderNumber: string; status: string }
  | { type: "inventory.changed"; variantId: string; stockAfter: number };

/**
 * Tell listeners (dashboard realtime, cache invalidation) that business data changed.
 * pg_notify inside a transaction is delivered only on COMMIT, so a rolled-back order never announces itself.
 */
export async function emit(tx: DbOrTx, e: BusinessEvent) {
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(e)})`);
}
