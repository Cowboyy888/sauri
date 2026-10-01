import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getIncomingInventory } from "@/lib/admin/purchasing";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { dateShort, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Incoming inventory" };

export default async function IncomingInventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("incoming", () => getIncomingInventory(db), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Incoming inventory" description="On order but not yet received — never counted as sellable stock." />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load incoming inventory." /> :
          <DataTable caption="Incoming" rows={res.data} rowKey={(r) => `${r.poId}-${r.sku}`} basePath="/admin/inventory/incoming" params={{}}
            empty={<EmptyState title="Nothing incoming right now" />}
            columns={[
              { key: "po", header: "PO", cell: (r) => <Link href={`/admin/purchases/${r.poId}`} className="hover:underline">{r.poNumber}</Link> },
              { key: "s", header: "Supplier", cell: (r) => r.supplierName },
              { key: "p", header: "Product", cell: (r) => r.productName },
              { key: "sku", header: "SKU", cell: (r) => <code className="text-xs">{r.sku}</code>, hideBelow: "md" },
              { key: "q", header: "Ordered", align: "right", cell: (r) => int(r.quantity), hideBelow: "lg" },
              { key: "rem", header: "Remaining", align: "right", cell: (r) => int(r.remaining) },
              { key: "ed", header: "Expected", cell: (r) => (r.expectedDeliveryDate ? dateShort(r.expectedDeliveryDate) : "—") },
              { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            ]} />}
      </Card>
    </div>
  );
}
