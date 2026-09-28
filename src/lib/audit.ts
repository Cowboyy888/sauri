import type { DbOrTx } from "./db/client";
import { auditLogs, notifications } from "./db/schema";
import type { Actor } from "./auth/permissions";

export async function audit(tx: DbOrTx, actor: Actor, action: string, entity: string, entityId: string | null, before?: unknown, after?: unknown) {
  await tx.insert(auditLogs).values({
    userId: actor.userId, actor: actor.name, action, entity, entityId,
    before: before === undefined ? null : before, after: after === undefined ? null : after,
  });
}

type NotificationType = typeof notifications.$inferInsert["type"];
export async function notify(tx: DbOrTx, type: NotificationType, title: string, body = "", reference: string | null = null) {
  await tx.insert(notifications).values({ type, title, body, reference });
}
