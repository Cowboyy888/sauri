import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getCampaignPerformance, getOverallCAC } from "@/lib/analytics/marketing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardBody } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { Field, Input } from "@/components/ui/field";

export const metadata = { title: "Marketing analytics" };

export default async function MarketingAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const campaignFilter = one(sp.campaign)?.toLowerCase(), sourceFilter = one(sp.source)?.toLowerCase(), mediumFilter = one(sp.medium)?.toLowerCase();
  const res = await safe("marketing-analytics", async () => {
    const [rows, cac] = await Promise.all([getCampaignPerformance(db, r), getOverallCAC(db, r)]);
    const filtered = rows.filter((c) =>
      (!campaignFilter || c.slug.toLowerCase().includes(campaignFilter) || c.name.toLowerCase().includes(campaignFilter)) &&
      (!sourceFilter || c.source.toLowerCase().includes(sourceFilter)) &&
      (!mediumFilter || c.medium.toLowerCase().includes(mediumFilter)));
    return { rows: filtered, cac };
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Marketing analytics" description={`${rangeLabel(parsed)} · factual performance, not a ranking`}>
        <AnalyticsNav current="marketing" query={rangeQuery(parsed)} />
      </PageHeader>

      {!res.ok ? <ErrorState message="Unable to load marketing analytics." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KPICard label="Total ad spend" value={money(res.data.cac.spendCents)} change={null} comparison="" />
            <KPICard label="New customers" value={int(res.data.cac.newCustomers)} change={null} comparison="" />
            <KPICard label="Customer acquisition cost" value={res.data.cac.cacCents == null ? "N/A" : money(res.data.cac.cacCents)} change={null} comparison="" note="Spend ÷ new customers" />
          </div>

          <Card>
            <CardBody>
              <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" method="get">
                {Object.entries(rangeQuery(parsed)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                <Field label="Campaign"><Input name="campaign" defaultValue={one(sp.campaign)} placeholder="Search by name or ID" /></Field>
                <Field label="Source"><Input name="source" defaultValue={one(sp.source)} placeholder="instagram" /></Field>
                <Field label="Medium"><Input name="medium" defaultValue={one(sp.medium)} placeholder="social" /></Field>
                <div className="self-end"><button type="submit" className="h-9 rounded-md border border-line px-3.5 text-[13px] font-medium hover:bg-canvas">Filter</button></div>
              </form>
            </CardBody>
          </Card>

          <Card>
            <DataTable caption="Campaign ROI" rows={res.data.rows} rowKey={(c) => c.id} basePath="/admin/analytics/marketing" params={rangeQuery(parsed)}
              empty={<EmptyState title="No campaigns match" />}
              columns={[
                { key: "n", header: "Campaign", cell: (c) => c.name },
                { key: "st", header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
                { key: "sp", header: "Spend", align: "right", cell: (c) => money(c.spendCents) },
                { key: "r", header: "Revenue", align: "right", cell: (c) => money(c.revenueCents) },
                { key: "o", header: "Orders", align: "right", cell: (c) => int(c.orders) },
                { key: "c", header: "Customers", align: "right", cell: (c) => int(c.newCustomers + c.returningCustomers), hideBelow: "md" },
                { key: "roas", header: "ROAS", align: "right", cell: (c) => (c.roas == null ? "N/A" : `${c.roas.toFixed(1)}x`) },
                { key: "roi", header: "ROI", align: "right", cell: (c) => (c.roi == null ? "N/A" : `${c.roi.toFixed(0)}%`) },
                { key: "cac", header: "CAC", align: "right", cell: (c) => (c.cac == null ? "N/A" : money(c.cac)), hideBelow: "lg" },
              ]} />
          </Card>
          <p className="text-xs text-subtle">ROAS = revenue ÷ spend. ROI = (revenue − spend) ÷ spend × 100. Both show &ldquo;N/A&rdquo;, never a fabricated number, when no spend has been logged for that campaign.</p>
        </>
      )}
    </div>
  );
}
