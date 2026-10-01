import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getPurchaseAnalytics, getPurchaseVsSales } from "@/lib/analytics/purchasing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/states";

export const metadata = { title: "Purchase analytics" };

export default async function PurchaseAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("purchase-analytics", async () => ({ purchases: await getPurchaseAnalytics(db, r), comparison: await getPurchaseVsSales(db, r) }), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Purchase analytics" description={rangeLabel(parsed)}>
        <AnalyticsNav current="purchases" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load purchase analytics." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard label="Purchase orders" value={int(res.data.purchases.purchaseOrders)} change={null} comparison="" />
            <KPICard label="Purchase spend" value={money(res.data.purchases.purchaseSpendCents)} change={null} comparison="" />
            <KPICard label="Units purchased" value={int(res.data.purchases.unitsPurchased)} change={null} comparison="" />
            <KPICard label="Average cost" value={res.data.purchases.averageCostCents == null ? "—" : money(res.data.purchases.averageCostCents)} change={null} comparison="" />
            <KPICard label="Open purchase orders" value={int(res.data.purchases.openPurchaseOrders)} change={null} comparison="" note="All time" />
            <KPICard label="Incoming inventory value" value={money(res.data.purchases.incomingInventoryValueCents)} change={null} comparison="" note="On order, not yet sellable" />
          </div>

          <Card>
            <CardHeader title="Purchase vs. sales" description="Three different numbers — purchase spend is never the same thing as COGS." />
            <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted">Sales revenue</p><p className="text-lg font-semibold">{money(res.data.comparison.salesRevenueCents)}</p></div>
              <div><p className="text-xs text-muted">Purchase spend</p><p className="text-lg font-semibold">{money(res.data.comparison.purchaseSpendCents)}</p></div>
              <div><p className="text-xs text-muted">COGS (goods sold)</p><p className="text-lg font-semibold">{money(res.data.comparison.cogsCents)}</p></div>
              <div><p className="text-xs text-muted">Inventory value</p><p className="text-lg font-semibold">{money(res.data.comparison.inventoryValueCents)}</p></div>
              <div><p className="text-xs text-muted">Units sold</p><p className="text-lg font-semibold">{int(res.data.comparison.unitsSold)}</p></div>
              <div><p className="text-xs text-muted">Units purchased</p><p className="text-lg font-semibold">{int(res.data.comparison.unitsPurchased)}</p></div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Spend by supplier" />
            <CardBody className="grid grid-cols-1 gap-2">
              {res.data.purchases.supplierSpend.length === 0 ? <EmptyState title="No spend in this period" /> : res.data.purchases.supplierSpend.map((s) => (
                <div key={s.supplierName} className="flex items-center justify-between text-[13px]"><span>{s.supplierName}</span><span className="font-medium">{money(s.spendCents)}</span></div>
              ))}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
