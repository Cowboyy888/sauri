/**
 * Cash flow reporting (brief §12) — buckets the same four real tables `summary.ts` sums (customer payments,
 * supplier payments, expenses actually paid, refunds actually paid back) rather than a fifth "transactions"
 * table (see docs/FINANCE_AUDIT.md §2 for why one was deliberately not built).
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { STORE } from "../config";
import type { Range, SeriesUnit } from "../analytics/service";
import { autoUnit } from "../analytics/service";
import { n, rows } from "../admin/sql";

export type CashFlowPoint = { bucket: string; cashInCents: number; cashOutCents: number; netCents: number; cumulativeCents: number };

/** Same generate_series bucketing technique as `analytics/service.ts#getSeries` — kept local rather than
 *  exported from there, since this unions four different source tables/date columns, not one. */
export async function getCashFlowSeries(db: DbOrTx, r: Range, opts: { unit?: SeriesUnit; openingBalanceCents?: number } = {}): Promise<{ unit: SeriesUnit; points: CashFlowPoint[] }> {
  const u = opts.unit ?? autoUnit(r), tz = STORE.timezone, uu = sql.raw(`'${u}'`), step = sql.raw(`'1 ${u}'::interval`);
  const pts = await rows<{ bucket: string; cash_in: string; cash_out: string }>(db, sql`
    with buckets as (
      select generate_series(date_trunc(${uu}, ${r.from.toISOString()}::timestamptz at time zone ${tz}),
                              date_trunc(${uu}, (${r.to.toISOString()}::timestamptz - interval '1 microsecond') at time zone ${tz}), ${step}) as bucket
    ), inflow as (
      select date_trunc(${uu}, o.paid_at at time zone ${tz}) as bucket, sum(p.amount_cents) as amt
      from payments p join orders o on o.id = p.order_id where p.status = 'succeeded' and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}
      group by 1
    ), outflow as (
      select bucket, sum(amt) as amt from (
        select date_trunc(${uu}, paid_at at time zone ${tz}) as bucket, amount_cents as amt from purchase_payments
        where paid_at >= ${r.from.toISOString()} and paid_at < ${r.to.toISOString()}
        union all
        select date_trunc(${uu}, paid_at at time zone ${tz}) as bucket, amount_cents as amt from expenses
        where status = 'PAID' and paid_at >= ${r.from.toISOString()} and paid_at < ${r.to.toISOString()}
        union all
        select date_trunc(${uu}, created_at at time zone ${tz}) as bucket, amount_cents as amt from refunds
        where created_at >= ${r.from.toISOString()} and created_at < ${r.to.toISOString()}
      ) x group by bucket
    )
    select to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI') as bucket, coalesce(i.amt, 0) as cash_in, coalesce(o.amt, 0) as cash_out
    from buckets b left join inflow i on i.bucket = b.bucket left join outflow o on o.bucket = b.bucket
    order by b.bucket`);
  let running = opts.openingBalanceCents ?? 0;
  return {
    unit: u,
    points: pts.map((p) => {
      const cashInCents = n(p.cash_in), cashOutCents = n(p.cash_out), netCents = cashInCents - cashOutCents;
      running += netCents;
      return { bucket: p.bucket, cashInCents, cashOutCents, netCents, cumulativeCents: running };
    }),
  };
}
