import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getCashFlowSeries } from "@/lib/finance/cash-flow";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, moneyKpi, bucketLabel } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/states";
import { MiniTrend } from "@/components/admin/charts";

export const metadata = { title: "Cash flow" };

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("cash-flow", () => getCashFlowSeries(db, r), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Cash flow" description={`${rangeLabel(parsed)} · revenue ≠ cash received, expense ≠ cash paid — this page shows actual cash movement only.`}>
        <FinanceNav current="cash-flow" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load cash flow data." /> : (
        <>
          {(() => {
            const totalIn = res.data.points.reduce((a, p) => a + p.cashInCents, 0), totalOut = res.data.points.reduce((a, p) => a + p.cashOutCents, 0);
            return (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <KPICard label="Cash inflows" value={moneyKpi(totalIn)} change={null} comparison="" />
                <KPICard label="Cash outflows" value={moneyKpi(totalOut)} change={null} comparison="" invert />
                <KPICard label="Net cash flow" value={moneyKpi(totalIn - totalOut)} change={null} comparison="" tone={totalIn - totalOut < 0 ? "neg" : undefined} />
              </div>
            );
          })()}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Net cash flow" description="Cash in minus cash out, per period." /><CardBody><MiniTrend points={res.data.points} unit={res.data.unit} dataKey="netCents" label="Net cash flow" format="money" /></CardBody></Card>
            <Card><CardHeader title="Cumulative cash position" description="Running total across the period." /><CardBody><MiniTrend points={res.data.points} unit={res.data.unit} dataKey="cumulativeCents" label="Cumulative" format="money" /></CardBody></Card>
          </div>
          <Card>
            <CardHeader title="Cash in vs. cash out by period" />
            <CardBody className="overflow-x-auto">
              <table className="w-full text-[13px]"><caption className="sr-only">Cash flow by period</caption>
                <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5">Period</th><th className="py-1.5 text-right">Cash in</th><th className="py-1.5 text-right">Cash out</th><th className="py-1.5 text-right">Net</th></tr></thead>
                <tbody>{res.data.points.map((p) => (
                  <tr key={p.bucket} className="border-b border-line-soft">
                    <td className="py-1.5">{bucketLabel(p.bucket, res.data.unit, true)}</td>
                    <td className="py-1.5 text-right num">{money(p.cashInCents)}</td>
                    <td className="py-1.5 text-right num">{money(p.cashOutCents)}</td>
                    <td className="py-1.5 text-right num font-medium">{money(p.netCents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
