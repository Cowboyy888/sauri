import { getDb } from "@/lib/db/client";
import { getCohortAnalysis, getRetentionMetrics } from "@/lib/analytics/retention";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState, ErrorState } from "@/components/admin/states";

export const metadata = { title: "Retention analytics" };

export default async function RetentionAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("retention", async () => ({ metrics: await getRetentionMetrics(db, r), cohorts: await getCohortAnalysis(db, 6, 6) }), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Retention analytics" description={`${rangeLabel(parsed)}. Metric definitions are exact — see the hint on each card; "churn" is always a proxy (customers who did not return), never a prediction.`}>
        <AnalyticsNav current="customers" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <Card><ErrorState message="Unable to load retention data." /></Card> : (
        <>
          <section aria-label="Retention figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KPICard label="Repeat purchase rate" value={res.data.metrics.repeatPurchaseRatePct != null ? pct(res.data.metrics.repeatPurchaseRatePct) : "No data"} change={null} comparison="" note="All-time buyers with 2+ orders" />
            <KPICard label="Second purchase rate" value={res.data.metrics.secondPurchaseRatePct != null ? pct(res.data.metrics.secondPurchaseRatePct) : "No data"} change={null} comparison="" note="First-time buyers in this period who ever bought again" />
            <KPICard label="Retention rate" value={res.data.metrics.retentionRatePct != null ? pct(res.data.metrics.retentionRatePct) : "No data"} change={null} comparison="" note="Of the previous period's buyers, who bought again now" />
            <KPICard label="Churn (proxy)" value={res.data.metrics.churnProxyPct != null ? pct(res.data.metrics.churnProxyPct) : "No data"} change={null} comparison="" tone={res.data.metrics.churnProxyPct != null && res.data.metrics.churnProxyPct > 50 ? "warn" : undefined} note="100% − retention rate, not a prediction" />
            <KPICard label="Avg. days between orders" value={res.data.metrics.avgDaysBetweenOrders != null ? String(res.data.metrics.avgDaysBetweenOrders) : "No data"} change={null} comparison="" note="Customers with 2+ orders, all time" />
          </section>
          <Card>
            <CardHeader title="Cohort retention" description="Grouped by the calendar month of each customer's first order; each cell is the share still placing orders in that month after their first (brief §31)." />
            {!res.data.cohorts.length ? <EmptyState title="Not enough order history yet" /> : (
              <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Cohort retention</caption>
                <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Cohort</th><th className="num px-3 font-medium">Size</th>{res.data.cohorts[0]!.months.map((_, i) => <th key={i} className="num px-3 font-medium">Month {i}</th>)}</tr></thead>
                <tbody>{res.data.cohorts.map((c) => (
                  <tr key={c.cohort} className="border-b border-line-soft last:border-0">
                    <td className="py-2.5 pl-4 font-medium">{c.cohort}</td><td className="num px-3">{c.size}</td>
                    {c.months.map((m, i) => <td key={i} className="num px-3">{m == null ? <span className="text-subtle">—</span> : `${m}%`}</td>)}
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
