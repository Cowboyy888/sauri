import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getCollectionAnalytics } from "@/lib/analytics/marketing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";

export const metadata = { title: "Collection analytics" };

export default async function CollectionAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("collections", () => getCollectionAnalytics(db, r), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Collection analytics" description={`${rangeLabel(parsed)} · editorial collections (e.g. Celestial), not category pages`}>
        <AnalyticsNav current="collections" query={rangeQuery(parsed)} />
      </PageHeader>
      <Card>
        {!res.ok ? <ErrorState message="Unable to load collection analytics." /> :
          <DataTable caption="Collections" rows={res.data} rowKey={(c) => c.id} basePath="/admin/analytics/collections" params={rangeQuery(parsed)}
            empty={<EmptyState title="No collections yet" description="Create one under Content." />}
            columns={[
              { key: "n", header: "Collection", cell: (c) => c.name },
              { key: "v", header: "Views", align: "right", cell: (c) => int(c.views) },
              { key: "pv", header: "Product views", align: "right", cell: (c) => int(c.productViews), hideBelow: "md" },
              { key: "ca", header: "Add to cart", align: "right", cell: (c) => int(c.addToCart), hideBelow: "md" },
              { key: "o", header: "Orders", align: "right", cell: (c) => int(c.orders) },
              { key: "r", header: "Revenue", align: "right", cell: (c) => money(c.revenueCents) },
              { key: "u", header: "Units sold", align: "right", cell: (c) => int(c.unitsSold), hideBelow: "lg" },
              { key: "cv", header: "Conv. rate", align: "right", cell: (c) => (c.conversionRate == null ? "—" : pct(c.conversionRate)) },
            ]} />}
      </Card>
    </div>
  );
}
