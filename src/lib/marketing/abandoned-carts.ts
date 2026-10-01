/**
 * Abandoned-cart tracking (brief §19). Scoped to signed-in customers only — the cart itself is client-only
 * (`localStorage`, docs/CHECKOUT.md) and there is no server-side anonymous cart to mirror; see docs/CRM.md
 * for that scope decision. No recovery email is ever sent from here (brief: "do not automatically send
 * recovery emails yet unless explicitly configured") — this is tracking architecture only.
 * No `import "server-only"` guard here: `markCartRecovered()` is a transitive dependency of
 * `lib/orders/service.ts`, which `scripts/seed.ts` also imports directly as a plain Node script (outside
 * Next.js's module graph, where the guard would unconditionally throw regardless of the actual call site).
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { abandonedCarts, customers } from "../db/schema";
import { n, rows } from "../admin/sql";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { ValidationError } from "../errors";
import { emailProvider, abandonedCartRecoveryEmail } from "../email/provider";

export type CartSyncItem = { variantId: string; quantity: number; unitPriceCents: number; name: string };

/** Debounced-synced from the client cart provider whenever a signed-in customer's cart changes. An empty
 *  cart removes the row entirely — nothing to recover once it's empty. */
export async function syncAbandonedCart(db: Db, customerId: string, items: CartSyncItem[]) {
  if (!items.length) { await db.delete(abandonedCarts).where(eq(abandonedCarts.customerId, customerId)); return; }
  const cartValueCents = items.reduce((a, i) => a + i.unitPriceCents * i.quantity, 0);
  const now = new Date();
  await db.insert(abandonedCarts).values({ customerId, items, cartValueCents, status: "active", lastActivityAt: now })
    .onConflictDoUpdate({ target: abandonedCarts.customerId, set: { items, cartValueCents, status: "active", lastActivityAt: now } });
}

/** Called once an order is placed — if this customer had a tracked cart, it's the one that converted. */
export async function markCartRecovered(db: DbOrTx, customerId: string, orderId: string) {
  await db.update(abandonedCarts).set({ status: "recovered", recoveredOrderId: orderId }).where(eq(abandonedCarts.customerId, customerId));
}

export type AbandonedCartRow = {
  id: string; customerId: string; customerName: string; customerEmail: string; items: CartSyncItem[]; itemCount: number;
  cartValueCents: number; effectiveStatus: "active" | "abandoned" | "recovered"; createdAt: Date; lastActivityAt: Date;
};

/** "Abandoned" isn't a stored transition — it's purely a function of time since the last activity, so it's
 *  computed at read time (`effectiveStatus`) rather than needing a sweep/cron to flip a stored value, the
 *  same "derive it live" approach segments already use. */
export async function listAbandonedCarts(db: DbOrTx, thresholdHours: number, page: number, pageSize: number): Promise<{ rows: AbandonedCartRow[]; total: number }> {
  const res = await db.select({
    id: abandonedCarts.id, customerId: abandonedCarts.customerId, name: customers.name, email: customers.email,
    items: abandonedCarts.items, cartValueCents: abandonedCarts.cartValueCents, status: abandonedCarts.status,
    createdAt: abandonedCarts.createdAt, lastActivityAt: abandonedCarts.lastActivityAt, total: sql<number>`count(*) over ()`,
  }).from(abandonedCarts).innerJoin(customers, eq(customers.id, abandonedCarts.customerId))
    .orderBy(desc(abandonedCarts.lastActivityAt)).limit(pageSize).offset((page - 1) * pageSize);

  return {
    total: n(res[0]?.total),
    rows: res.map((r) => {
      const ageHours = (Date.now() - new Date(r.lastActivityAt).getTime()) / 3_600_000;
      const effectiveStatus = r.status === "recovered" ? "recovered" : ageHours >= thresholdHours ? "abandoned" : "active";
      const items = r.items as CartSyncItem[];
      return { id: r.id, customerId: r.customerId, customerName: r.name, customerEmail: r.email, items, itemCount: items.reduce((a, i) => a + i.quantity, 0), cartValueCents: r.cartValueCents, effectiveStatus, createdAt: new Date(r.createdAt), lastActivityAt: new Date(r.lastActivityAt) };
    }),
  };
}

/**
 * Staff-triggered recovery send (brief §20) — real, but never automatic: the business explicitly clicks
 * "send now" for one cart. A scheduled automation would call this same function on a timer once the
 * business turns on `settings.marketing.abandonedCartAutomation.enabled` and a cron slot is available
 * (docs/PHASE_7_AUDIT.md — the Hobby-plan cron slot is already used by release-reservations).
 */
export async function sendAbandonedCartRecoveryNow(db: Db, actor: Actor, cartId: string) {
  assertCan(actor, "marketing:write");
  const [row] = await db.select({ email: customers.email, name: customers.name, items: abandonedCarts.items, status: abandonedCarts.status })
    .from(abandonedCarts).innerJoin(customers, eq(customers.id, abandonedCarts.customerId)).where(eq(abandonedCarts.id, cartId));
  if (!row) throw new ValidationError("Cart not found.");
  if (row.status === "recovered") throw new ValidationError("This cart has already been recovered.");
  const items = row.items as CartSyncItem[];
  await emailProvider.send(abandonedCartRecoveryEmail({ email: row.email, name: row.name, itemCount: items.reduce((a, i) => a + i.quantity, 0) }));
  await audit(db, actor, "Sent abandoned-cart recovery email", "abandoned_cart", cartId, undefined, { email: row.email });
}

export async function abandonedCartKpis(db: DbOrTx, thresholdHours: number) {
  const [row] = await rows<{ active: string; abandoned: string; value: string }>(db, sql`
    select
      count(*) filter (where status <> 'recovered' and last_activity_at >= now() - (${thresholdHours} || ' hours')::interval) as active,
      count(*) filter (where status <> 'recovered' and last_activity_at < now() - (${thresholdHours} || ' hours')::interval) as abandoned,
      coalesce(sum(cart_value_cents) filter (where status <> 'recovered'), 0) as value
    from abandoned_carts`);
  return { active: n(row?.active), abandoned: n(row?.abandoned), openCartValueCents: n(row?.value) };
}
