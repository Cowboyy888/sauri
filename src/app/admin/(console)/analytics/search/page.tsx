import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getSearchAnalytics, getSearchConversion } from "@/lib/analytics/marketing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { int, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";

export const metadata = { title: "Search analytics" };

export default async function SearchAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("search", async () => ({ top: await getSearchAnalytics(db, r), conv: await getSearchConversion(db, r) }), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Search analytics" description={`${rangeLabel(parsed)} · what customers are looking for`}>
        <AnalyticsNav current="search" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <ErrorState message="Unable to load search analytics." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KPICard label="Total searches" value={int(res.data.conv.searches)} change={null} comparison="" />
            <KPICard label="Zero-result searches" value={int(res.data.conv.zeroResult)} change={null} comparison="" tone={res.data.conv.zeroResult > 0 ? "warn" : undefined} />
            <KPICard label="Zero-result rate" value={res.data.conv.zeroResultRate == null ? "—" : pct(res.data.conv.zeroResultRate)} change={null} comparison="" href="/admin/analytics/search/zero-results" />
          </div>
          <Card>
            <DataTable caption="Top searches" rows={res.data.top} rowKey={(x) => x.query} basePath="/admin/analytics/search" params={rangeQuery(parsed)}
              empty={<EmptyState title="No searches recorded yet" />}
              columns={[
                { key: "q", header: "Search term", cell: (x) => x.query },
                { key: "c", header: "Count", align: "right", cell: (x) => int(x.count) },
                { key: "r", header: "Results found", align: "right", cell: (x) => (x.resultsFound > 0 ? int(x.resultsFound) : <span className="text-neg">0</span>) },
              ]} />
          </Card>
          <p className="text-xs text-subtle"><Link href="/admin/analytics/search/zero-results" className="text-accent hover:underline">See every zero-result search →</Link></p>
        </>
      )}
    </div>
  );
}
