import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listPurchaseOrders } from "@/lib/purchasing/orders";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, pageParams, type SearchParams } from "@/lib/admin/range";
import { money, dateShort, int } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Purchase orders" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("purchasing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), { page, pageSize } = pageParams(sp);
  const status = one(sp.status);
  const res = await safe("purchases", () => listPurchaseOrders(db, { status, page, pageSize }), one(sp.fail));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Purchase orders" description="From draft to received." actions={
        <div className="flex gap-2">
          {g.can("inventory:write") && <Link href="/admin/purchases/receiving"><Button>Receiving</Button></Link>}
          {g.can("purchasing:write") && <Link href="/admin/purchases/new"><Button variant="primary">New purchase order</Button></Link>}
        </div>
      } />
      <Card>
        {!res.ok ? <ErrorState message="Unable to load purchase orders." /> : <>
          <DataTable caption="Purchase orders" rows={res.data.rows} rowKey={(o) => o.id} basePath="/admin/purchases" params={{ status: status ?? undefined }}
            empty={<EmptyState title="No purchase orders yet" />}
            columns={[
              { key: "n", header: "PO number", cell: (o) => <Link href={`/admin/purchases/${o.id}`} className="font-medium hover:underline">{o.poNumber}</Link> },
              { key: "s", header: "Supplier", cell: (o) => o.supplierName },
              { key: "d", header: "Date", cell: (o) => dateShort(o.orderDate), hideBelow: "md" },
              { key: "ed", header: "Expected delivery", cell: (o) => (o.expectedDeliveryDate ? dateShort(o.expectedDeliveryDate) : "—"), hideBelow: "lg" },
              { key: "i", header: "Items", align: "right", cell: (o) => `${int(o.receivedQty)} / ${int(o.orderedQty)}`, hideBelow: "md" },
              { key: "t", header: "Total", align: "right", cell: (o) => money(o.totalCents) },
              { key: "st", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
              { key: "p", header: "Payment", cell: (o) => <StatusBadge status={o.paymentStatus} />, hideBelow: "lg" },
            ]} />
          <Pagination page={page} pageSize={pageSize} total={res.data.total} basePath="/admin/purchases" params={{ status: status ?? undefined }} />
        </>}
      </Card>
    </div>
  );
}
