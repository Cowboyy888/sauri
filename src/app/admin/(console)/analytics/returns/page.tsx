import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getReturnMetrics } from "@/lib/analytics/returns";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { int, money, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Returns analytics" };

export default async function ReturnsAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("returns", () => getReturnMetrics(db, r), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Returns analytics" description={`${rangeLabel(parsed)} · completed orders by date paid, returns by date requested. Return rate = returned ÷ completed × 100 (brief §34).`}>
        <AnalyticsNav current="returns" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <Card><ErrorState message="Unable to load returns analytics." /></Card> : (
        <>
          <section aria-label="Returns key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPICard label="Completed orders" value={int(res.data.completedOrders)} change={null} comparison="" />
            <KPICard label="Orders with a return" value={int(res.data.returnedOrders)} change={null} comparison="" />
            <KPICard label="Return rate" value={res.data.returnRatePct != null ? pct(res.data.returnRatePct) : "No data"} change={null} comparison="" tone={res.data.returnRatePct != null && res.data.returnRatePct > 10 ? "warn" : undefined} />
            <KPICard label="Refunded (returns)" value={money(res.data.refundedCents)} change={null} comparison="" />
          </section>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="By reason" />
              {!res.data.byReason.length ? <EmptyState title="No returns in this period" /> : (
                <ul className="divide-y divide-line-soft text-[13px]">{res.data.byReason.map((x) => (
                  <li key={x.reason} className="flex items-center justify-between gap-3 px-4 py-2.5"><StatusBadge status={x.reason} /><span className="num font-medium">{int(x.count)}</span></li>
                ))}</ul>
              )}
            </Card>
            <Card>
              <CardHeader title="By inspection disposition" description="Only restock returns sellable stock (brief §24)." />
              {!res.data.byDisposition.length ? <EmptyState title="No inspections in this period" /> : (
                <ul className="divide-y divide-line-soft text-[13px]">{res.data.byDisposition.map((x) => (
                  <li key={x.disposition} className="flex items-center justify-between gap-3 px-4 py-2.5"><StatusBadge status={x.disposition} /><span className="num font-medium">{int(x.count)}</span></li>
                ))}</ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
