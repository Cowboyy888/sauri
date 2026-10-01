import { getDb } from "@/lib/db/client";
import { getReorderSuggestions } from "@/lib/admin/purchasing";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { Thumb } from "@/components/admin/thumb";
import { TargetStockLevelButton } from "@/components/admin/purchasing-forms";

export const metadata = { title: "Reorder" };

export default async function ReorderPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("reorder", () => getReorderSuggestions(db), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Reorder" description="Suggested quantity = target stock level − available − incoming. Nothing here creates a purchase order automatically." />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load reorder suggestions." /> :
          <DataTable caption="Variants at or below reorder level" rows={res.data} rowKey={(r) => r.variantId} basePath="/admin/inventory/reorder" params={{}}
            empty={<EmptyState title="Nothing needs reordering right now" />}
            columns={[
              { key: "p", header: "Product", cell: (r) => <div className="flex items-center gap-2.5"><Thumb src={r.image} alt="" size={32} /><span>{r.productName} — {r.label}</span></div> },
              { key: "s", header: "SKU", cell: (r) => <code className="text-xs">{r.sku}</code>, hideBelow: "md" },
              { key: "st", header: "Stock", align: "right", cell: (r) => int(r.stockQuantity), hideBelow: "lg" },
              { key: "res", header: "Reserved", align: "right", cell: (r) => int(r.reservedQuantity), hideBelow: "xl" },
              { key: "av", header: "Available", align: "right", cell: (r) => <span className={r.availableStock <= 0 ? "text-neg" : ""}>{int(r.availableStock)}</span> },
              { key: "rl", header: "Reorder level", align: "right", cell: (r) => int(r.reorderLevel), hideBelow: "md" },
              { key: "sup", header: "Supplier", cell: (r) => r.preferredSupplierName || "—", hideBelow: "lg" },
              { key: "lc", header: "Last cost", align: "right", cell: (r) => (r.lastCostCents != null ? money(r.lastCostCents) : "—"), hideBelow: "xl" },
              { key: "lt", header: "Lead time", align: "right", cell: (r) => (r.leadTimeDays != null ? `${r.leadTimeDays}d` : "—"), hideBelow: "xl" },
              { key: "inc", header: "Incoming", align: "right", cell: (r) => int(r.incomingQuantity), hideBelow: "lg" },
              { key: "sug", header: "Suggested qty", align: "right", cell: (r) => <span className="font-semibold">{int(r.suggestedQuantity)}</span> },
              { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (r) => g.can("inventory:write") ? <TargetStockLevelButton variantId={r.variantId} current={r.targetStockLevel} /> : null },
            ]} />}
      </Card>
    </div>
  );
}
