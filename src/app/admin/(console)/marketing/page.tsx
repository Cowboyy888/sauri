import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getCampaignPerformance, getChannelPerformance, getMarketingOverview } from "@/lib/analytics/marketing";
import { getMarketingSettings } from "@/lib/marketing/settings";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, pct, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { MarketingSettingsForm } from "@/components/admin/marketing-forms";

export const metadata = { title: "Marketing" };

export default async function MarketingHub({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("marketing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("marketing", async () => {
    const [overview, campaigns, channels, settings] = await Promise.all([
      getMarketingOverview(db, r), getCampaignPerformance(db, r), getChannelPerformance(db, r), getMarketingSettings(db),
    ]);
    return { overview, campaigns, channels, settings };
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Marketing" description={`${rangeLabel(parsed)} · attribution: ${res.ok ? res.data.settings.attributionModel.replace("_", " ").toLowerCase() : "—"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/marketing/campaigns" className="text-[13px] font-medium text-accent hover:underline">Campaigns</Link>
          <Link href="/admin/marketing/promotions" className="text-[13px] font-medium text-accent hover:underline">Promotions</Link>
          <Link href="/admin/marketing/coupons" className="text-[13px] font-medium text-accent hover:underline">Coupons</Link>
          <Link href="/admin/marketing/email" className="text-[13px] font-medium text-accent hover:underline">Email</Link>
          <Link href="/admin/marketing/abandoned-carts" className="text-[13px] font-medium text-accent hover:underline">Abandoned carts</Link>
          <Link href="/admin/marketing/calendar" className="text-[13px] font-medium text-accent hover:underline">Calendar</Link>
        </div>
      </PageHeader>

      {!res.ok ? <ErrorState message="Unable to load marketing data." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard label="Marketing revenue" value={money(res.data.overview.marketingRevenueCents)} change={null} comparison="" note="Orders with a known campaign" />
            <KPICard label="Marketing orders" value={int(res.data.overview.marketingOrders)} change={null} comparison="" note={`${int(res.data.overview.marketingCustomers)} customers`} />
            <KPICard label="Conversion rate" value={res.data.overview.conversionRate == null ? "—" : pct(res.data.overview.conversionRate)} change={null} comparison="" note="Orders ÷ qualified sessions" />
            <KPICard label="Average order value" value={money(res.data.overview.averageOrderValueCents)} change={null} comparison="" note="Marketing-attributed orders" />
            <KPICard label="Discount amount" value={money(res.data.overview.discountAmountCents)} change={null} comparison="" note="On marketing-attributed orders" />
            <KPICard label="New customer revenue" value={money(res.data.overview.newCustomerRevenueCents)} change={null} comparison="" />
            <KPICard label="Returning customer revenue" value={money(res.data.overview.returningCustomerRevenueCents)} change={null} comparison="" />
          </div>

          <Card>
            <CardHeader title="Campaign performance" description="Sessions and funnel figures are counted in this date range; revenue is attributed by the configured touch model." />
            <DataTable caption="Campaigns" rows={res.data.campaigns} rowKey={(c) => c.id} basePath="/admin/marketing" params={rangeQuery(parsed)}
              empty={<EmptyState title="No campaigns yet" description="Create one from the Campaigns page." />}
              columns={[
                { key: "n", header: "Campaign", cell: (c) => <Link href={`/admin/marketing/campaigns`} className="font-medium hover:underline">{c.name}</Link> },
                { key: "st", header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
                { key: "s", header: "Sessions", align: "right", cell: (c) => int(c.sessions), hideBelow: "md" },
                { key: "o", header: "Orders", align: "right", cell: (c) => int(c.orders) },
                { key: "r", header: "Revenue", align: "right", cell: (c) => money(c.revenueCents) },
                { key: "cv", header: "Conv. rate", align: "right", cell: (c) => (c.conversionRate == null ? "—" : pct(c.conversionRate)), hideBelow: "lg" },
                { key: "aov", header: "AOV", align: "right", cell: (c) => money(c.averageOrderValueCents), hideBelow: "xl" },
                { key: "d", header: "Discounts", align: "right", cell: (c) => money(c.discountCents), hideBelow: "xl" },
                { key: "roas", header: "ROAS", align: "right", cell: (c) => (c.roas == null ? "N/A" : `${c.roas.toFixed(1)}x`) },
                { key: "roi", header: "ROI", align: "right", cell: (c) => (c.roi == null ? "N/A" : pct(c.roi)) },
              ]} />
          </Card>

          <Card>
            <CardHeader title="Channel performance" description="Organic, paid and social channels, classified from UTM parameters." />
            <DataTable caption="Channels" rows={res.data.channels} rowKey={(c) => c.channel} basePath="/admin/marketing" params={rangeQuery(parsed)}
              empty={<EmptyState title="No channel traffic yet" />}
              columns={[
                { key: "c", header: "Channel", cell: (c) => c.channel },
                { key: "s", header: "Sessions", align: "right", cell: (c) => int(c.sessions) },
                { key: "o", header: "Orders", align: "right", cell: (c) => int(c.orders) },
                { key: "r", header: "Revenue", align: "right", cell: (c) => money(c.revenueCents) },
                { key: "aov", header: "AOV", align: "right", cell: (c) => money(c.averageOrderValueCents), hideBelow: "lg" },
                { key: "cv", header: "Conv. rate", align: "right", cell: (c) => (c.conversionRate == null ? "—" : pct(c.conversionRate)), hideBelow: "md" },
                { key: "spend", header: "Ad spend", align: "right", cell: (c) => (c.adSpendCents == null ? "N/A" : money(c.adSpendCents)), hideBelow: "xl" },
                { key: "roas", header: "ROAS", align: "right", cell: (c) => (c.roas == null ? "N/A" : `${c.roas.toFixed(1)}x`) },
              ]} />
          </Card>

          {g.can("marketing:write") && (
            <Card>
              <CardHeader title="Marketing settings" description="Attribution model and discount-stacking policy." />
              <CardBody><MarketingSettingsForm settings={res.data.settings} /></CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
