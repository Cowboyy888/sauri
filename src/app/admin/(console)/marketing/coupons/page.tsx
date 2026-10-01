import { getDb } from "@/lib/db/client";
import { listPromotions, getCouponAnalytics } from "@/lib/marketing/promotions";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { PromotionActiveToggle } from "@/components/admin/marketing-forms";

export const metadata = { title: "Coupons" };

/**
 * A dedicated, code-focused view of the same `discounts` rows /admin/marketing/promotions manages (see
 * docs/PHASE_7_AUDIT.md) — usage, revenue and discount cost, so the business can see whether a coupon is
 * actually driving incremental sales (brief §16), not just whether it's configured correctly.
 */
export default async function CouponsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("marketing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("coupons", async () => {
    const promotions = await listPromotions(db);
    const analytics = new Map(await Promise.all(promotions.map(async (p) => [p.id, await getCouponAnalytics(db, p.id)] as const)));
    return { promotions, analytics };
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Coupons" description="Revenue and discount cost per code — manage rules from Promotions." />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load coupons." /> :
          <DataTable caption="Coupons" rows={res.data.promotions} rowKey={(d) => d.id} basePath="/admin/marketing/coupons" params={{}}
            empty={<EmptyState title="No coupons yet" />}
            columns={[
              { key: "c", header: "Code", cell: (d) => <span className="font-semibold tracking-wide">{d.code}</span> },
              { key: "st", header: "Status", cell: (d) => <StatusBadge status={d.state} /> },
              { key: "u", header: "Usage", align: "right", cell: (d) => int(res.data.analytics.get(d.id)?.usageCount ?? 0) },
              { key: "o", header: "Orders", align: "right", cell: (d) => int(res.data.analytics.get(d.id)?.orders ?? 0), hideBelow: "md" },
              { key: "r", header: "Revenue", align: "right", cell: (d) => money(res.data.analytics.get(d.id)?.revenueCents ?? 0) },
              { key: "dc", header: "Discount cost", align: "right", cell: (d) => money(res.data.analytics.get(d.id)?.discountCostCents ?? 0) },
              { key: "aov", header: "AOV", align: "right", cell: (d) => money(res.data.analytics.get(d.id)?.averageOrderValueCents ?? 0), hideBelow: "lg" },
              { key: "nc", header: "New / returning", cell: (d) => `${int(res.data.analytics.get(d.id)?.newCustomers ?? 0)} / ${int(res.data.analytics.get(d.id)?.returningCustomers ?? 0)}`, hideBelow: "xl" },
              { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (d) => g.can("marketing:write") ? <PromotionActiveToggle id={d.id} active={d.active} /> : null },
            ]} />}
      </Card>
    </div>
  );
}
