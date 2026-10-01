import { getDb } from "@/lib/db/client";
import { listCampaigns, getCampaignActualSpendCents } from "@/lib/marketing/campaigns";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, dateShort } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { NewCampaignButton, EditCampaignButton, CampaignStatusControl, LogCostButton, CampaignUrlBuilder } from "@/components/admin/marketing-forms";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("marketing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("campaigns", async () => {
    const campaigns = await listCampaigns(db);
    const spend = new Map(await Promise.all(campaigns.map(async (c) => [c.id, await getCampaignActualSpendCents(db, c.id)] as const)));
    return { campaigns, spend };
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Campaigns" description="A campaign's ID is matched against utm_campaign, case-insensitively." actions={g.can("marketing:write") && <NewCampaignButton />} />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load campaigns." /> :
          <DataTable caption="Campaigns" rows={res.data.campaigns} rowKey={(c) => c.id} basePath="/admin/marketing/campaigns" params={{}}
            empty={<EmptyState title="No campaigns yet" description="Create your first campaign to start tracking UTM traffic and revenue." />}
            columns={[
              { key: "n", header: "Name", cell: (c) => <span className="font-medium">{c.name}</span> },
              { key: "id", header: "Campaign ID", cell: (c) => <code className="text-xs">{c.slug}</code> },
              { key: "sm", header: "Source / medium", cell: (c) => `${c.source} / ${c.medium}`, hideBelow: "md" },
              { key: "st", header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
              { key: "b", header: "Budget", align: "right", cell: (c) => (c.budgetCents == null ? "—" : money(c.budgetCents)), hideBelow: "lg" },
              { key: "sp", header: "Spend", align: "right", cell: (c) => money(res.data.spend.get(c.id) ?? 0) },
              { key: "d", header: "Dates", cell: (c) => (c.startDate ? `${dateShort(c.startDate)} → ${c.endDate ? dateShort(c.endDate) : "ongoing"}` : "—"), hideBelow: "xl" },
              { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (c) => g.can("marketing:write") ? <div className="flex flex-wrap justify-end gap-1.5"><EditCampaignButton campaign={c} /><LogCostButton campaignId={c.id} /><CampaignStatusControl id={c.id} status={c.status} /></div> : null },
            ]} />}
      </Card>
      {!res.ok ? null : (
        <Card>
          <CardHeader title="Campaign URL builder" description="Generates a tracking URL with the right utm_* parameters. Copy it for a post, bio link, or ad." />
          <CardBody><CampaignUrlBuilder campaigns={res.data.campaigns} /></CardBody>
        </Card>
      )}
    </div>
  );
}
