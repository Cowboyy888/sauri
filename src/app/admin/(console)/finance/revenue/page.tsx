import { getDb } from "@/lib/db/client";
import { getMetrics, getSalesBy, getSalesByChannel, getSeries, getTopCustomers, resolveRange, type Range } from "@/lib/analytics/service";
import { getCustomerPaymentsByMethod } from "@/lib/finance/customer-payments";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int, moneyKpi, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/states";
import { BarBreakdown, CategoryBreakdown, SalesChart, type Group } from "@/components/admin/charts";

export const metadata = { title: "Revenue" };

async function load(db: ReturnType<typeof getDb>, r: Range) {
  const [m, series, products, cats, channels, byMethod, topCustomers] = await Promise.all([
    getMetrics(db, r), getSeries(db, r), getSalesBy(db, r, "product"), getSalesBy(db, r, "category"), getSalesByChannel(db, r), getCustomerPaymentsByMethod(db, r), getTopCustomers(db, 10),
  ]);
  const perCategory = await Promise.all(cats.map(async (c) => [c.key, (await getSalesBy(db, r, "product", { categorySlug: c.key })).slice(0, 8)] as const));
  return { m, series, products, cats, channels, byMethod, topCustomers, perCategory: Object.fromEntries(perCategory) as Record<string, Group[]> };
}

export default async function RevenuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("revenue", () => load(db, r), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Revenue" description={rangeLabel(parsed)}>
        <FinanceNav current="revenue" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load revenue data." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPICard label="Gross sales" value={moneyKpi(res.data.m.grossSalesCents)} change={null} comparison="" />
            <KPICard label="Net sales" value={moneyKpi(res.data.m.netRevenueCents)} change={null} comparison="" />
            <KPICard label="Discounts" value={moneyKpi(res.data.m.discountCents)} change={null} comparison="" />
            <KPICard label="Refunds" value={moneyKpi(res.data.m.refundCents)} change={null} comparison="" />
            <KPICard label="Orders" value={int(res.data.m.orders)} change={null} comparison="" />
            <KPICard label="Units sold" value={int(res.data.m.units)} change={null} comparison="" />
            <KPICard label="Average order value" value={money(res.data.m.averageOrderValueCents)} change={null} comparison="" />
            <KPICard label="Tax collected" value={money(res.data.m.taxCents)} change={null} comparison="" note="Pass-through" />
          </div>
          <Card><CardHeader title="Revenue trend" description="Revenue, orders, profit and units by period." /><CardBody><SalesChart points={res.data.series.points} unit={res.data.series.unit} rangeLabel={rangeLabel(parsed)} /></CardBody></Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Revenue by product" /><CardBody><BarBreakdown groups={res.data.products.slice(0, 12)} ariaLabel="Revenue by product" /></CardBody></Card>
            <Card><CardHeader title="Revenue by channel" /><CardBody><BarBreakdown groups={res.data.channels} ariaLabel="Revenue by channel" /></CardBody></Card>
          </div>
          <Card><CardHeader title="Revenue by category" description="Click a category to see its products." /><CardBody><CategoryBreakdown groups={res.data.cats} productsByCategory={res.data.perCategory} /></CardBody></Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Revenue by payment method" />
              <CardBody>
                {res.data.byMethod.length === 0 ? <EmptyState title="No payments in this period" /> : (
                  <table className="w-full text-[13px]"><caption className="sr-only">Revenue by payment method</caption>
                    <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5">Method</th><th className="py-1.5 text-right">Amount</th><th className="py-1.5 text-right">Count</th></tr></thead>
                    <tbody>{res.data.byMethod.map((x) => <tr key={x.provider} className="border-b border-line-soft"><td className="py-1.5">{x.provider}</td><td className="py-1.5 text-right num">{money(x.totalCents)}</td><td className="py-1.5 text-right num">{int(x.count)}</td></tr>)}</tbody>
                  </table>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Revenue by customer" description="Top 10 by lifetime spend." />
              <CardBody>
                {res.data.topCustomers.length === 0 ? <EmptyState title="No customers yet" /> : (
                  <table className="w-full text-[13px]"><caption className="sr-only">Revenue by customer</caption>
                    <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5">Customer</th><th className="py-1.5 text-right">Orders</th><th className="py-1.5 text-right">Lifetime spend</th></tr></thead>
                    <tbody>{res.data.topCustomers.map((c) => <tr key={c.customerId} className="border-b border-line-soft"><td className="py-1.5">{c.name}</td><td className="py-1.5 text-right num">{int(c.totalOrders)}</td><td className="py-1.5 text-right num">{money(c.totalSpentCents)}</td></tr>)}</tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>
          <p className="text-xs text-subtle">Gross margin on revenue: {pct(res.data.m.grossMarginPct)}. Use <a href="/admin/finance/reports" className="underline">Reports</a> to filter by date and export.</p>
        </>
      )}
    </div>
  );
}
