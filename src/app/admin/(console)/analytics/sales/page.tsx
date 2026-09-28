import { Suspense } from "react";
import { getDb } from "@/lib/db/client";
import { getMetrics, getSeries, resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { comparisonLabel, one, parseRange, pctChange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { int, money, moneyKpi, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { MiniTrend } from "@/components/admin/charts";
import { ErrorState } from "@/components/admin/states";
import { CardSkeleton, KpiSkeleton } from "@/components/admin/skeleton";
import { ExportMenu } from "@/components/admin/export-menu";

export const metadata = { title: "Sales analytics" };

export default async function SalesAnalytics({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, parsed = parseRange(sp);
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Sales analytics" description={`${rangeLabel(parsed)} · ${comparisonLabel(parsed)}`} actions={g.can("reports:read") && <ExportMenu report="daily-sales" params={{}} />}>
        <AnalyticsNav current="sales" query={rangeQuery(parsed)} />
      </PageHeader>
      <Suspense key={JSON.stringify(rangeQuery(parsed))} fallback={<><KpiSkeleton count={7} /><CardSkeleton chart /></>}><Body sp={sp} /></Suspense>
    </div>
  );
}

async function Body({ sp }: { sp: SearchParams }) {
  const db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom), cmp = comparisonLabel(parsed);
  const res = await safe("sales", async () => ({ m: await getMetrics(db, r), p: await getMetrics(db, r.previous), s: await getSeries(db, r) }), one(sp.fail));
  if (!res.ok) return <Card><ErrorState message="Unable to load sales data." /></Card>;
  const { m, p, s } = res.data;
  return (
    <>
      <section aria-label="Sales figures" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KPICard label="Revenue" value={moneyKpi(m.netRevenueCents)} change={pctChange(m.netRevenueCents, p.netRevenueCents)} comparison={cmp} hint="Net of discounts and refunds" />
        <KPICard label="Orders" value={int(m.orders)} change={pctChange(m.orders, p.orders)} comparison={cmp} />
        <KPICard label="Units sold" value={int(m.units)} change={pctChange(m.units, p.units)} comparison={cmp} />
        <KPICard label="AOV" value={money(m.averageOrderValueCents)} change={pctChange(m.averageOrderValueCents, p.averageOrderValueCents)} comparison={cmp} hint="Net revenue ÷ orders" />
        <KPICard label="COGS" value={moneyKpi(m.cogsCents)} change={pctChange(m.cogsCents, p.cogsCents)} comparison={cmp} invert />
        <KPICard label="Gross profit" value={moneyKpi(m.grossProfitCents)} change={pctChange(m.grossProfitCents, p.grossProfitCents)} comparison={cmp} hint="Revenue − COGS" />
        <KPICard label="Gross margin" value={pct(m.grossMarginPct)} change={pctChange(m.grossMarginPct, p.grossMarginPct)} comparison={cmp} hint="Profit ÷ net revenue" />
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Revenue trend" description={`Per ${s.unit}`} /><CardBody><MiniTrend points={s.points} unit={s.unit} dataKey="netRevenueCents" label="Revenue" format="money" /></CardBody></Card>
        <Card><CardHeader title="Orders trend" description={`Per ${s.unit}`} /><CardBody><MiniTrend points={s.points} unit={s.unit} dataKey="orders" label="Orders" format="int" /></CardBody></Card>
        <Card><CardHeader title="Profit trend" description="Gross profit = revenue − COGS" /><CardBody><MiniTrend points={s.points} unit={s.unit} dataKey="grossProfitCents" label="Gross profit" format="money" /></CardBody></Card>
        <Card><CardHeader title="Units sold trend" description={`Per ${s.unit}`} /><CardBody><MiniTrend points={s.points} unit={s.unit} dataKey="units" label="Units sold" format="int" /></CardBody></Card>
      </div>
    </>
  );
}
