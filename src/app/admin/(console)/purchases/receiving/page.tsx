import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listPurchaseOrders } from "@/lib/purchasing/orders";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { money, dateShort, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Receiving" };

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("inventory:write");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const res = await safe("receiving", async () => {
    const [approved, ordered, partial] = await Promise.all([
      listPurchaseOrders(db, { status: "APPROVED", page: 1, pageSize: 100 }),
      listPurchaseOrders(db, { status: "ORDERED", page: 1, pageSize: 100 }),
      listPurchaseOrders(db, { status: "PARTIALLY_RECEIVED", page: 1, pageSize: 100 }),
    ]);
    return [...approved.rows, ...ordered.rows, ...partial.rows].sort((a, b) => a.orderDate.getTime() - b.orderDate.getTime());
  }, one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Receiving" description="Select a purchase order to record what arrived." />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load purchase orders." /> :
          <DataTable caption="Purchase orders ready to receive" rows={res.data} rowKey={(o) => o.id} basePath="/admin/purchases/receiving" params={{}}
            empty={<EmptyState title="Nothing to receive" description="Approved or ordered purchase orders will appear here." />}
            columns={[
              { key: "n", header: "PO number", cell: (o) => o.poNumber },
              { key: "s", header: "Supplier", cell: (o) => o.supplierName },
              { key: "ed", header: "Expected", cell: (o) => (o.expectedDeliveryDate ? dateShort(o.expectedDeliveryDate) : "—"), hideBelow: "md" },
              { key: "i", header: "Received", align: "right", cell: (o) => `${int(o.receivedQty)} / ${int(o.orderedQty)}` },
              { key: "t", header: "Total", align: "right", cell: (o) => money(o.totalCents), hideBelow: "lg" },
              { key: "st", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
              { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (o) => <Link href={`/admin/purchases/${o.id}`}><Button size="sm" variant="primary">Receive</Button></Link> },
            ]} />}
      </Card>
    </div>
  );
}
