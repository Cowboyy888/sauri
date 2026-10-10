import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getFinancialSummary } from "@/lib/finance/summary";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, comparisonLabel, pctChange, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { moneyKpi, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/states";

export const metadata = { title: "Finance" };

const naPct = (v: number | null) => (v == null ? "N/A" : pct(v));

export default async function FinanceOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("finance-overview", async () => ({ cur: await getFinancialSummary(db, r), prev: await getFinancialSummary(db, r.previous) }), one(sp.fail));
  const cmp = comparisonLabel(parsed);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Finance" description={`${rangeLabel(parsed)} · operational management figures, not a certified accounting statement`}>
        <FinanceNav current="overview" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load the financial overview." /> : (
        <>
          <Card>
            <CardHeader title="Revenue" />
            <CardBody className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KPICard label="Gross sales" value={moneyKpi(res.data.cur.grossSalesCents)} change={pctChange(res.data.cur.grossSalesCents, res.data.prev.grossSalesCents)} comparison={cmp} />
              <KPICard label="Discounts" value={moneyKpi(res.data.cur.discountCents)} change={pctChange(res.data.cur.discountCents, res.data.prev.discountCents)} comparison={cmp} invert />
              <KPICard label="Refunds" value={moneyKpi(res.data.cur.refundCents)} change={pctChange(res.data.cur.refundCents, res.data.prev.refundCents)} comparison={cmp} invert />
              <KPICard label="Net revenue" value={moneyKpi(res.data.cur.netRevenueCents)} change={pctChange(res.data.cur.netRevenueCents, res.data.prev.netRevenueCents)} comparison={cmp} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Cost & profit" />
            <CardBody className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KPICard label="COGS" value={moneyKpi(res.data.cur.cogsCents)} change={pctChange(res.data.cur.cogsCents, res.data.prev.cogsCents)} comparison={cmp} invert />
              <KPICard label="Gross profit" value={moneyKpi(res.data.cur.grossProfitCents)} change={pctChange(res.data.cur.grossProfitCents, res.data.prev.grossProfitCents)} comparison={cmp} />
              <KPICard label="Gross margin" value={naPct(res.data.cur.grossMarginPct)} change={res.data.cur.grossMarginPct != null && res.data.prev.grossMarginPct != null ? pctChange(res.data.cur.grossMarginPct, res.data.prev.grossMarginPct) : null} comparison={cmp} />
              <KPICard label="Operating margin" value={naPct(res.data.cur.operatingMarginPct)} change={res.data.cur.operatingMarginPct != null && res.data.prev.operatingMarginPct != null ? pctChange(res.data.cur.operatingMarginPct, res.data.prev.operatingMarginPct) : null} comparison={cmp} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Cash" description="Actual cash movement — distinct from the accrual figures above." />
            <CardBody className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KPICard label="Cash in" value={moneyKpi(res.data.cur.cashInCents)} change={pctChange(res.data.cur.cashInCents, res.data.prev.cashInCents)} comparison={cmp} href="/admin/finance/cash-flow" />
              <KPICard label="Cash out" value={moneyKpi(res.data.cur.cashOutCents)} change={pctChange(res.data.cur.cashOutCents, res.data.prev.cashOutCents)} comparison={cmp} invert href="/admin/finance/cash-flow" />
              <KPICard label="Net cash flow" value={moneyKpi(res.data.cur.netCashFlowCents)} change={pctChange(res.data.cur.netCashFlowCents, res.data.prev.netCashFlowCents)} comparison={cmp} tone={res.data.cur.netCashFlowCents < 0 ? "neg" : undefined} href="/admin/finance/cash-flow" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Purchasing" />
            <CardBody className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KPICard label="Total purchases" value={moneyKpi(res.data.cur.totalPurchasesCents)} change={pctChange(res.data.cur.totalPurchasesCents, res.data.prev.totalPurchasesCents)} comparison={cmp} />
            </CardBody>
          </Card>
          <p className="text-xs text-subtle">All figures are computed server-side from the same records used throughout the admin (orders, payments, purchase orders, expenses) — see <a href="/admin/finance/reports" className="underline">Reports</a> for exports.</p>
        </>
      )}
    </div>
  );
}
