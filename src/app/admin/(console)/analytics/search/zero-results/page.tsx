import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getZeroResultSearches } from "@/lib/analytics/marketing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { int, dateTimeFull } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";

export const metadata = { title: "Zero-result searches" };

export default async function ZeroResultSearchesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("zero-results", () => getZeroResultSearches(db, r), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Zero-result searches" description={`${rangeLabel(parsed)} · demand gaps — what customers want but can't find. Nothing here creates a product automatically.`} />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load zero-result searches." /> :
          <DataTable caption="Zero-result searches" rows={res.data} rowKey={(x) => x.query} basePath="/admin/analytics/search/zero-results" params={rangeQuery(parsed)}
            empty={<EmptyState title="No zero-result searches in this period" />}
            columns={[
              { key: "q", header: "Search term", cell: (x) => x.query },
              { key: "c", header: "Count", align: "right", cell: (x) => int(x.count) },
              { key: "l", header: "Last searched", cell: (x) => dateTimeFull(x.lastSearchedAt) },
            ]} />}
      </Card>
    </div>
  );
}
