import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listSuppliers } from "@/lib/purchasing/suppliers";
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
import { SupplierFormButton, SupplierStatusControl } from "@/components/admin/purchasing-forms";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("suppliers", () => listSuppliers(db), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Suppliers" description="Who supplies each product, on what terms." actions={g.can("purchasing:write") && <SupplierFormButton mode="create" label="New supplier" />} />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load suppliers." /> :
          <DataTable caption="Suppliers" rows={res.data} rowKey={(s) => s.id} basePath="/admin/suppliers" params={{}}
            empty={<EmptyState title="No suppliers yet" description="Add your first supplier to start tracking purchases." />}
            columns={[
              { key: "n", header: "Supplier", cell: (s) => <Link href={`/admin/suppliers/${s.id}`} className="font-medium hover:underline">{s.name}</Link> },
              { key: "c", header: "Contact", cell: (s) => s.contactPerson || s.email || s.phone || "—", hideBelow: "md" },
              { key: "p", header: "Products", align: "right", cell: (s) => int(s.products) },
              { key: "po", header: "Purchase orders", align: "right", cell: (s) => int(s.purchaseOrders), hideBelow: "lg" },
              { key: "sp", header: "Total spend", align: "right", cell: (s) => money(s.totalSpendCents) },
              { key: "out", header: "Outstanding", align: "right", cell: (s) => money(s.outstandingCents), hideBelow: "xl" },
              { key: "st", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
              { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (s) => g.can("purchasing:write") ? <SupplierStatusControl id={s.id} status={s.status as "ACTIVE" | "INACTIVE" | "BLOCKED"} /> : null },
            ]} />}
      </Card>
    </div>
  );
}
