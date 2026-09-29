import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getShippingMetrics } from "@/lib/analytics/shipping";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { duration, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Shipping analytics" };

export default async function ShippingAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("shipping", () => getShippingMetrics(db, r), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Shipping analytics" description={`${rangeLabel(parsed)} · by date paid. Fulfillment time = shipped − paid; delivery time = delivered − shipped (brief §35).`}>
        <AnalyticsNav current="shipping" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <Card><ErrorState message="Unable to load shipping analytics." /></Card> : (
        <>
          <section aria-label="Shipping key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPICard label="Orders shipped" value={int(res.data.ordersShipped)} change={null} comparison="" />
            <KPICard label="Orders delivered" value={int(res.data.ordersDelivered)} change={null} comparison="" />
            <KPICard label="Avg. fulfillment time" value={res.data.avgFulfillmentHours != null ? duration(res.data.avgFulfillmentHours) : "No data"} change={null} comparison="" hint="Paid → shipped" />
            <KPICard label="Avg. delivery time" value={res.data.avgDeliveryHours != null ? duration(res.data.avgDeliveryHours) : "No data"} change={null} comparison="" hint="Shipped → delivered" />
          </section>
          <Card>
            <CardHeader title="By carrier" description="Delivery time and failure rate per carrier used in this period." />
            {!res.data.byCarrier.length ? <EmptyState title="No packages in this period" /> : (
              <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Shipping by carrier</caption>
                <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Carrier</th><th className="num px-3 font-medium">Packages</th><th className="num px-3 font-medium">Avg. delivery time</th><th className="num px-3 pr-4 font-medium">Delivery failures</th></tr></thead>
                <tbody>{res.data.byCarrier.map((c) => (
                  <tr key={c.carrier} className="border-b border-line-soft last:border-0">
                    <td className="py-2.5 pl-4 font-medium">{c.carrier}</td>
                    <td className="num px-3">{int(c.packages)}</td>
                    <td className="num px-3">{c.avgDeliveryHours != null ? duration(c.avgDeliveryHours) : "—"}</td>
                    <td className="num px-3 pr-4">{c.deliveryFailures > 0 ? <StatusBadge status="delivery_failed" label={String(c.deliveryFailures)} /> : <span className="text-subtle">0</span>}</td>
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
