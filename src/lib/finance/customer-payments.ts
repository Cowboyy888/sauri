/**
 * Customer payment reporting (brief §10) — a read model over the existing `payments` table (Phase 4).
 * Never stores or displays raw card data: `provider_ref` is a provider-side reference id (e.g. a Stripe
 * PaymentIntent id), the same thing already shown throughout the admin, never card/account numbers.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { n, rows } from "../admin/sql";
import type { Range } from "../analytics/service";

export type CustomerPaymentRow = {
  id: string; orderId: string; orderNumber: string; customerName: string; provider: string; transactionRef: string | null;
  amountCents: number; refundedCents: number; currency: string; status: string; paidAt: Date | null; createdAt: Date;
};
export async function listCustomerPayments(db: DbOrTx, opts: { range?: Range; status?: string; page: number; pageSize: number }): Promise<{ rows: CustomerPaymentRow[]; total: number }> {
  const conds = [];
  if (opts.range) conds.push(sql`o.paid_at is not null and o.paid_at >= ${opts.range.from.toISOString()} and o.paid_at < ${opts.range.to.toISOString()}`);
  if (opts.status) conds.push(sql`p.status = ${opts.status}`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const res = await rows<Record<string, string | null>>(db, sql`
    select p.id, o.id as order_id, o.order_number, c.name as customer_name, p.provider, p.provider_ref, p.amount_cents, o.currency, p.status, o.paid_at, p.created_at,
      coalesce((select sum(r.amount_cents) from refunds r where r.order_id = o.id), 0) as refunded_cents,
      count(*) over () as total
    from payments p join orders o on o.id = p.order_id join customers c on c.id = o.customer_id
    ${where} order by p.created_at desc limit ${opts.pageSize} offset ${(opts.page - 1) * opts.pageSize}`);
  return {
    total: n(res[0]?.total),
    rows: res.map((r) => ({
      id: r.id!, orderId: r.order_id!, orderNumber: r.order_number!, customerName: r.customer_name!, provider: r.provider!, transactionRef: r.provider_ref ?? null,
      amountCents: n(r.amount_cents), refundedCents: n(r.refunded_cents), currency: r.currency!, status: r.status!,
      paidAt: r.paid_at ? new Date(r.paid_at) : null, createdAt: new Date(r.created_at!),
    })),
  };
}

export async function getCustomerPaymentsByMethod(db: DbOrTx, r: Range) {
  const res = await rows<{ provider: string; total: string; count: string }>(db, sql`
    select p.provider, sum(p.amount_cents) as total, count(*) as count
    from payments p join orders o on o.id = p.order_id
    where p.status = 'succeeded' and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}
    group by p.provider order by total desc`);
  return res.map((x) => ({ provider: x.provider, totalCents: n(x.total), count: n(x.count) }));
}
