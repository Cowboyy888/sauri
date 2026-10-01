import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { listPromotions } from "@/lib/marketing/promotions";
import { listCampaigns } from "@/lib/marketing/campaigns";
import { collections, products } from "@/lib/db/schema";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, dateShort, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { PromotionFormButton, PromotionActiveToggle, DeletePromotionButton } from "@/components/admin/marketing-forms";

export const metadata = { title: "Promotions" };

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("marketing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("promotions", async () => {
    const [promotions, allProducts, allCollections, campaigns] = await Promise.all([
      listPromotions(db),
      db.select({ id: products.id, name: products.name }).from(products).where(eq(products.status, "active")),
      db.select({ id: collections.id, name: collections.name }).from(collections),
      listCampaigns(db),
    ]);
    return { promotions, allProducts, allCollections, campaigns };
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Promotions" description="Percent, fixed or free-shipping codes with product, collection, segment or first-order eligibility — enforced server-side at checkout."
        actions={res.ok && g.can("marketing:write") && <PromotionFormButton mode="create" label="New promotion" products={res.data.allProducts} collections={res.data.allCollections} campaigns={res.data.campaigns} />} />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load promotions." /> :
          <DataTable caption="Promotions" rows={res.data.promotions} rowKey={(d) => d.id} basePath="/admin/marketing/promotions" params={{}}
            empty={<EmptyState title="No promotions yet" />}
            columns={[
              { key: "c", header: "Code", cell: (d) => <span className="font-semibold tracking-wide">{d.code}</span> },
              { key: "n", header: "Name", cell: (d) => d.name ?? "—", hideBelow: "md" },
              { key: "o", header: "Offer", cell: (d) => d.type === "percent" ? `${d.value}% off` : d.type === "fixed" ? `${money(d.value)} off` : "Free shipping" },
              { key: "e", header: "Eligibility", cell: (d) => [d.eligibleProductIds.length ? `${d.eligibleProductIds.length} product(s)` : null, d.eligibleCollectionIds.length ? `${d.eligibleCollectionIds.length} collection(s)` : null, d.eligibleSegments.length ? `${d.eligibleSegments.length} segment(s)` : null, d.firstOrderOnly ? "First order only" : null].filter(Boolean).join(", ") || "Everyone", hideBelow: "lg" },
              { key: "dt", header: "Dates", cell: (d) => <span className="whitespace-nowrap text-muted">{dateShort(d.startsAt)} → {d.endsAt ? dateShort(d.endsAt) : "no end"}</span>, hideBelow: "xl" },
              { key: "u", header: "Used", align: "right", cell: (d) => `${int(d.usedCount)}${d.usageLimit != null ? ` / ${int(d.usageLimit)}` : ""}` },
              { key: "st", header: "Status", cell: (d) => <StatusBadge status={d.state} /> },
              { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (d) => g.can("marketing:write") && res.ok ? (
                <div className="flex justify-end gap-1.5">
                  <PromotionFormButton mode="edit" label="Edit" initial={d} products={res.data.allProducts} collections={res.data.allCollections} campaigns={res.data.campaigns} />
                  <PromotionActiveToggle id={d.id} active={d.active} />
                  <DeletePromotionButton id={d.id} usedCount={d.usedCount} />
                </div>
              ) : null },
            ]} />}
      </Card>
    </div>
  );
}
