import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getSupplierPerformance } from "@/lib/analytics/purchasing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";

export const metadata = { title: "Supplier analytics" };

export default async function SupplierAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("supplier-analytics", () => getSupplierPerformance(db, r), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Supplier analytics" description={`${rangeLabel(parsed)} · only from real receiving data`}>
        <AnalyticsNav current="suppliers" query={rangeQuery(parsed)} />
      </PageHeader>
      <Card>
        {!res.ok ? <ErrorState message="Unable to load supplier analytics." /> :
          <DataTable caption="Suppliers" rows={res.data} rowKey={(s) => s.supplierId} basePath="/admin/analytics/suppliers" params={rangeQuery(parsed)}
            empty={<EmptyState title="No purchase orders in this period" />}
            columns={[
              { key: "n", header: "Supplier", cell: (s) => s.supplierName },
              { key: "po", header: "Purchase orders", align: "right", cell: (s) => int(s.purchaseOrders) },
              { key: "u", header: "Units purchased", align: "right", cell: (s) => int(s.unitsPurchased) },
              { key: "sp", header: "Total spend", align: "right", cell: (s) => money(s.totalSpendCents) },
              { key: "ac", header: "Average cost", align: "right", cell: (s) => (s.averageCostCents == null ? "—" : money(s.averageCostCents)), hideBelow: "md" },
              { key: "lt", header: "Avg. lead time", align: "right", cell: (s) => (s.averageLeadTimeDays == null ? "—" : `${s.averageLeadTimeDays}d`), hideBelow: "lg" },
              { key: "late", header: "Late deliveries", align: "right", cell: (s) => int(s.lateDeliveries), hideBelow: "lg" },
              { key: "rej", header: "Rejected", align: "right", cell: (s) => int(s.rejectedQuantity), hideBelow: "xl" },
              { key: "dam", header: "Damaged", align: "right", cell: (s) => int(s.damagedQuantity), hideBelow: "xl" },
            ]} />}
      </Card>
    </div>
  );
}
