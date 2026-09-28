import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getCustomerAnalytics, getCustomerSeries, resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { comparisonLabel, one, parseRange, pctChange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { rows } from "@/lib/admin/sql";
import { int, money, pct } from "@/lib/format";
import { sql } from "drizzle-orm";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { BarBreakdown, CustomerCharts } from "@/components/admin/charts";
import { ErrorState } from "@/components/admin/states";

export const metadata = { title: "Customer analytics" };

export default async function CustomerAnalytics({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom), cmp = comparisonLabel(parsed);
  const res = await safe("customers", async () => {
    const [a, p, series, top] = await Promise.all([
      getCustomerAnalytics(db, r), getCustomerAnalytics(db, r.previous), getCustomerSeries(db, r),
      rows<{ customer_id: string; name: string; rev: string; orders: string }>(db, sql`select c.id as customer_id, c.name, sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents) as rev, count(*) as orders from orders o join customers c on c.id = o.customer_id where o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()} group by c.id order by rev desc limit 10`),
    ]);
    return { a, p, series, top };
  }, one(sp.fail));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Customer analytics" description={`${rangeLabel(parsed)} · ${cmp}`}><AnalyticsNav current="customers" query={rangeQuery(parsed)} /></PageHeader>
      {!res.ok ? <Card><ErrorState message="Unable to load customer data." /></Card> : <>
        <section aria-label="Customer figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KPICard label="New customers" value={int(res.data.a.newCustomers)} change={pctChange(res.data.a.newCustomers, res.data.p.newCustomers)} comparison={cmp} hint="First paid order in the period" />
          <KPICard label="Returning customers" value={int(res.data.a.returningCustomers)} change={pctChange(res.data.a.returningCustomers, res.data.p.returningCustomers)} comparison={cmp} hint="Bought before and again now" />
          <KPICard label="Repeat purchase rate" value={pct(res.data.a.repeatPurchaseRatePct)} change={null} comparison="" note="All time: buyers with 2+ orders" />
          <KPICard label="Average customer value" value={money(res.data.a.revenuePerCustomerCents)} change={pctChange(res.data.a.revenuePerCustomerCents, res.data.p.revenuePerCustomerCents)} comparison={cmp} hint="Revenue per buying customer in the period" />
          <KPICard label="Customer lifetime value" value={money(res.data.a.averageLifetimeValueCents)} change={null} comparison="" note="Average across all buyers, all time" />
          <KPICard label="Average order value" value={money(res.data.a.averageOrderValueCents)} change={null} comparison="" note="Net revenue ÷ orders" />
        </section>
        <Card><CardHeader title="New vs returning, and customer growth" description={`Per ${res.data.series.unit}`} /><CardBody><CustomerCharts points={res.data.series.points} unit={res.data.series.unit} /></CardBody></Card>
        <Card><CardHeader title="Customer revenue" description="Top 10 customers by revenue in the period" /><CardBody>
          <BarBreakdown ariaLabel="Revenue by customer" groups={res.data.top.map((t) => ({ key: t.customer_id, label: t.name, netRevenueCents: Number(t.rev), grossProfitCents: 0, orders: Number(t.orders), units: 0, shareOfRevenuePct: 0 }))} />
          {g.can("customers:read") && <p className="mt-2 text-xs"><Link href="/admin/customers" className="font-medium text-accent hover:underline">All customers</Link></p>}
        </CardBody></Card>
      </>}
    </div>
  );
}
