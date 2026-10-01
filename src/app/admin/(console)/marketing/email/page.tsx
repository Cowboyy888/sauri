import { getDb } from "@/lib/db/client";
import { listEmailCampaigns, getEmailCampaignAnalytics } from "@/lib/marketing/email-campaigns";
import { listCampaigns } from "@/lib/marketing/campaigns";
import { getCampaignPerformance } from "@/lib/analytics/marketing";
import { resolveRange } from "@/lib/analytics/service";
import { categories } from "@/lib/db/schema";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, int, dateShort } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { NewEmailCampaignButton, SendEmailCampaignButton, CancelEmailCampaignButton } from "@/components/admin/marketing-forms";

export const metadata = { title: "Email campaigns" };

const AUDIENCE_LABEL: Record<string, string> = { segment: "Segment", loyalty_members: "Loyalty members", bought_category: "Bought a category", has_wishlist_items: "Has wishlist items" };

export default async function EmailCampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("marketing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("email", async () => {
    const allTime = await resolveRange(db, "all");
    const [campaigns, marketingCampaigns, allCategories, campaignPerf] = await Promise.all([
      listEmailCampaigns(db), listCampaigns(db), db.select({ id: categories.id, name: categories.name }).from(categories), getCampaignPerformance(db, allTime),
    ]);
    const perfById = new Map(campaignPerf.map((c) => [c.id, c]));
    const analytics = new Map(await Promise.all(campaigns.map(async (c) => {
      const revenue = c.campaignId ? perfById.get(c.campaignId)?.revenueCents ?? null : null;
      return [c.id, await getEmailCampaignAnalytics(db, c.id, revenue)] as const;
    })));
    return { campaigns, marketingCampaigns, allCategories, analytics };
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Email campaigns" description="Sends through the same email abstraction as every transactional email — no provider is configured yet, so sends are logged, not delivered. Only reaches customers with marketing consent."
        actions={res.ok && g.can("marketing:write") && <NewEmailCampaignButton categories={res.data.allCategories} campaigns={res.data.marketingCampaigns} />} />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load email campaigns." /> :
          <DataTable caption="Email campaigns" rows={res.data.campaigns} rowKey={(c) => c.id} basePath="/admin/marketing/email" params={{}}
            empty={<EmptyState title="No email campaigns yet" />}
            columns={[
              { key: "n", header: "Name", cell: (c) => <span className="font-medium">{c.name}</span> },
              { key: "au", header: "Audience", cell: (c) => AUDIENCE_LABEL[c.audience.type] ?? c.audience.type, hideBelow: "md" },
              { key: "st", header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
              { key: "sent", header: "Sent", align: "right", cell: (c) => int(res.data.analytics.get(c.id)?.sent ?? 0) },
              { key: "rpr", header: "Revenue / recipient", align: "right", cell: (c) => { const v = res.data.analytics.get(c.id)?.revenuePerRecipientCents; return v == null ? "N/A" : money(v); }, hideBelow: "lg" },
              { key: "when", header: "Sent at", cell: (c) => (c.sentAt ? dateShort(c.sentAt) : "—"), hideBelow: "xl" },
              { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (c) => g.can("marketing:write") && (c.status === "DRAFT" || c.status === "SCHEDULED") ? <div className="flex justify-end gap-1.5"><SendEmailCampaignButton id={c.id} /><CancelEmailCampaignButton id={c.id} /></div> : null },
            ]} />}
      </Card>
    </div>
  );
}
