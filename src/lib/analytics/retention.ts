/**
 * Customer retention (brief §30) and cohort analysis (brief §31). Every figure is defined precisely below
 * — churn is explicitly labeled a "proxy" (its complement, retention) rather than presented as an exact
 * probability a given customer will never return, which no methodology here can actually support. See
 * docs/CUSTOMER_ANALYTICS.md.
 */
import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import type { Range } from "./service";
import { n, rows } from "../admin/sql";

const RECOGNIZED = sql`o.paid_at is not null and o.status <> 'cancelled'`;

export type RetentionMetrics = {
  repeatPurchaseRatePct: number | null; secondPurchaseRatePct: number | null;
  retentionRatePct: number | null; churnProxyPct: number | null; avgDaysBetweenOrders: number | null;
};

/**
 * - **Repeat purchase rate** = customers with 2+ recognized orders ÷ customers with 1+ recognized order (all-time).
 * - **Second purchase rate** = of customers whose *first* recognized order falls in `r`, the share that
 *   ever placed a second one (by now, not just within `r`) — measures whether the first sale converts.
 * - **Retention rate** = of customers who ordered in the *previous* period of the same length as `r`, the
 *   share who also ordered again in `r`. **Churn proxy** = 100 − retention rate: customers who did not
 *   return, not a prediction that they never will.
 * - **Avg. days between orders** = average gap between consecutive recognized orders, for customers with
 *   at least two, across all their orders (not scoped to `r` — a single period rarely contains two orders
 *   for the same customer, so scoping this to `r` would starve it of data).
 */
export async function getRetentionMetrics(db: DbOrTx, r: Range): Promise<RetentionMetrics> {
  const periodLengthMs = r.to.getTime() - r.from.getTime();
  const prevFrom = new Date(r.from.getTime() - periodLengthMs), prevTo = r.from;

  const [row] = await rows<Record<string, string | null>>(db, sql`
    with buyers as (select o.customer_id, count(*) as orders from orders o where ${RECOGNIZED} group by o.customer_id),
    first_in_range as (select s.customer_id from customer_stats s where s.first_order_at >= ${r.from.toISOString()} and s.first_order_at < ${r.to.toISOString()}),
    prev_buyers as (select distinct o.customer_id from orders o where ${RECOGNIZED} and o.paid_at >= ${prevFrom.toISOString()} and o.paid_at < ${prevTo.toISOString()}),
    cur_buyers as (select distinct o.customer_id from orders o where ${RECOGNIZED} and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()})
    select
      (select count(*) from buyers) as total_buyers, (select count(*) from buyers where orders >= 2) as repeat_buyers,
      (select count(*) from first_in_range) as first_time_in_range,
      (select count(*) from first_in_range f join buyers b on b.customer_id = f.customer_id where b.orders >= 2) as first_time_who_repeated,
      (select count(*) from prev_buyers) as prev_period_buyers,
      (select count(*) from prev_buyers p join cur_buyers c on c.customer_id = p.customer_id) as retained`);

  const gaps = await rows<{ avg_days: string | null }>(db, sql`
    with ordered as (select customer_id, paid_at, lag(paid_at) over (partition by customer_id order by paid_at) as prev_paid_at from orders o where ${RECOGNIZED})
    select avg(extract(epoch from (paid_at - prev_paid_at)) / 86400.0) as avg_days from ordered where prev_paid_at is not null`);

  const totalBuyers = n(row?.total_buyers), prevPeriodBuyers = n(row?.prev_period_buyers), firstTimeInRange = n(row?.first_time_in_range);
  return {
    repeatPurchaseRatePct: totalBuyers ? Math.round((n(row?.repeat_buyers) / totalBuyers) * 1000) / 10 : null,
    secondPurchaseRatePct: firstTimeInRange ? Math.round((n(row?.first_time_who_repeated) / firstTimeInRange) * 1000) / 10 : null,
    retentionRatePct: prevPeriodBuyers ? Math.round((n(row?.retained) / prevPeriodBuyers) * 1000) / 10 : null,
    churnProxyPct: prevPeriodBuyers ? Math.round((1 - n(row?.retained) / prevPeriodBuyers) * 1000) / 10 : null,
    avgDaysBetweenOrders: gaps[0]?.avg_days != null ? Math.round(Number(gaps[0].avg_days) * 10) / 10 : null,
  };
}

export type CohortRow = { cohort: string; size: number; months: (number | null)[] };
/** Groups customers by the calendar month of their first recognized order, then reports what share of
 *  each cohort placed at least one more recognized order in month 0, 1, 2, … after that first purchase
 *  (brief §31). A cell is `null` (never a fabricated 0%) when the cohort hasn't existed long enough for
 *  that month to have happened yet — "only show percentages where sufficient data exists." */
export async function getCohortAnalysis(db: DbOrTx, monthsBack = 6, monthsForward = 6): Promise<CohortRow[]> {
  const cohorts = await rows<{ cohort_month: string; customer_id: string; first_order_at: string }>(db, sql`
    select to_char(date_trunc('month', first_order_at), 'YYYY-MM') as cohort_month, customer_id, first_order_at
    from customer_stats where first_order_at is not null and first_order_at >= date_trunc('month', now()) - (${monthsBack} || ' months')::interval`);
  if (!cohorts.length) return [];
  const customerIds = cohorts.map((c) => c.customer_id);
  const orderDates = await rows<{ customer_id: string; paid_at: string }>(db, sql`
    select customer_id, paid_at from orders o where ${RECOGNIZED} and customer_id in (${sql.join(customerIds.map((id) => sql`${id}`), sql`, `)})`);
  const ordersByCustomer = new Map<string, Date[]>();
  for (const o of orderDates) ordersByCustomer.set(o.customer_id, [...(ordersByCustomer.get(o.customer_id) ?? []), new Date(o.paid_at)]);

  const byMonth = new Map<string, typeof cohorts>();
  for (const c of cohorts) byMonth.set(c.cohort_month, [...(byMonth.get(c.cohort_month) ?? []), c]);

  const now = new Date();
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cohort, members]) => {
    const months: (number | null)[] = [];
    for (let m = 0; m <= monthsForward; m++) {
      const monthStart = new Date(members[0]!.first_order_at); monthStart.setUTCMonth(monthStart.getUTCMonth() + m, 1); monthStart.setUTCHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      if (monthStart > now) { months.push(null); continue; }
      const active = members.filter((c) => (ordersByCustomer.get(c.customer_id) ?? []).some((d) => d >= monthStart && d < monthEnd)).length;
      months.push(Math.round((active / members.length) * 1000) / 10);
    }
    return { cohort, size: members.length, months };
  });
}
