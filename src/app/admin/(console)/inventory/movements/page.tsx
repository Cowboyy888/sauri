import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listMovements } from "@/lib/admin/inventory";
import { one, pageParams, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Stock movements" };
const TYPES = ["PURCHASE", "SALE", "RETURN", "ADJUSTMENT", "DAMAGED", "LOST", "TRANSFER", "RESTOCK", "MANUAL"];

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("inventory:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), { page, pageSize } = pageParams(sp, 40);
  const params = { q: one(sp.q), type: one(sp.type) };
  const res = await safe("movements", () => listMovements(db, { ...params, page, pageSize }), one(sp.fail));
  const canOrders = g.can("orders:read");
  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/inventory" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Inventory</Link>
      <PageHeader title="Stock movements" description="The complete ledger. Newest first. Movements can’t be edited or deleted; corrections are new movements." />
      <Card>
        <FilterBar><SearchInput placeholder="Search product, SKU, reference or note" /><FilterSelect param="type" label="Type" options={TYPES.map((t) => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }))} /></FilterBar>
        {!res.ok ? <ErrorState message="Unable to load stock movements." /> : <>
          <DataTable caption="Stock movements" rows={res.data.rows} rowKey={(m) => String(m.id)} basePath="/admin/inventory/movements" params={params} dense empty={<EmptyState title="No movements match" />}
            columns={[
              { key: "d", header: "Date", cell: (m) => <span className="whitespace-nowrap">{dateTime(m.at)}</span> },
              { key: "p", header: "Product", cell: (m) => <div className="min-w-0 max-w-[240px]"><Link href={`/admin/products/${m.productId}?tab=inventory`} className="truncate font-medium hover:underline">{m.productName}</Link><p className="truncate text-xs text-muted">{m.label}</p></div> },
              { key: "sku", header: "SKU", cell: (m) => <span className="whitespace-nowrap text-xs text-muted">{m.sku}</span>, hideBelow: "lg" },
              { key: "t", header: "Type", cell: (m) => <StatusBadge status={m.type} /> },
              { key: "q", header: "Quantity", align: "right", cell: (m) => <b className={m.quantity < 0 ? "text-neg" : "text-pos"}>{m.quantity > 0 ? "+" : ""}{m.quantity}</b> },
              { key: "b", header: "Before", align: "right", cell: (m) => m.before, hideBelow: "sm" },
              { key: "a", header: "After", align: "right", cell: (m) => m.after, hideBelow: "sm" },
              { key: "r", header: "Reference", cell: (m) => m.orderId && canOrders ? <Link href={`/admin/orders/${m.orderId}`} className="whitespace-nowrap text-accent hover:underline">{m.reference}</Link> : <span className="whitespace-nowrap">{m.reference ?? "—"}</span>, hideBelow: "md" },
              { key: "u", header: "User", cell: (m) => m.user, hideBelow: "lg" },
              { key: "n", header: "Notes", cell: (m) => <span className="block max-w-[220px] truncate text-muted" title={m.notes ?? ""}>{m.notes ?? ""}</span>, hideBelow: "xl" },
            ]} />
          <Pagination {...res.data} basePath="/admin/inventory/movements" params={params} />
        </>}
      </Card>
    </div>
  );
}
