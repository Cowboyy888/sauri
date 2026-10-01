import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getStocktake } from "@/lib/purchasing/stocktake";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { StocktakeCountInput, CompleteStocktakeButton, CancelStocktakeButton } from "@/components/admin/purchasing-forms";

export const metadata = { title: "Stocktake" };

export default async function StocktakeDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const g = await guard("inventory:write");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params, sp = await searchParams, db = getDb();
  const res = await safe("stocktake-detail", () => getStocktake(db, id), one(sp.fail));
  if (res.ok && !res.data) notFound();

  return (
    <div className="grid grid-cols-1 gap-4">
      {!res.ok ? <ErrorState message="Unable to load this stocktake." /> : !res.data ? null : (
        <>
          <PageHeader title="Stocktake" description="Enter the counted quantity for each item, then apply the adjustment." actions={
            res.data.stocktake.status === "in_progress" ? <div className="flex gap-2"><CancelStocktakeButton id={id} /><CompleteStocktakeButton id={id} /></div> : <StatusBadge status={res.data.stocktake.status} />
          } />
          <Card>
            <DataTable caption="Count" rows={res.data.items} rowKey={(i) => i.id} basePath={`/admin/inventory/stocktake/${id}`} params={{}}
              empty={<EmptyState title="No items" />}
              columns={[
                { key: "s", header: "SKU", cell: (i) => <code className="text-xs">{i.sku}</code> },
                { key: "p", header: "Product", cell: (i) => i.productName },
                { key: "e", header: "Expected", align: "right", cell: (i) => int(i.expectedQuantity) },
                { key: "c", header: "Counted", align: "right", cell: (i) => (res.data!.stocktake.status === "in_progress" ? <StocktakeCountInput stocktakeId={id} variantId={i.variantId} defaultValue={i.countedQuantity} /> : (i.countedQuantity ?? "—")) },
                { key: "d", header: "Difference", align: "right", cell: (i) => (i.difference == null ? "—" : <span className={i.difference < 0 ? "text-neg" : i.difference > 0 ? "text-pos" : ""}>{i.difference > 0 ? `+${i.difference}` : i.difference}</span>) },
              ]} />
          </Card>
        </>
      )}
    </div>
  );
}
