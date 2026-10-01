import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listSupplierPayments, type SupplierPaymentRow } from "@/lib/finance/supplier-payments";
import { guard } from "@/lib/admin/guard";
import { one, pageParams } from "@/lib/admin/range";
import type { SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, dateShort } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Col } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { RecordPaymentForm } from "@/components/admin/purchasing-forms";

export const metadata = { title: "Supplier payments" };

export default async function SupplierPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const { page, pageSize } = pageParams(sp, 50);
  const status = one(sp.status) as SupplierPaymentRow["status"] | undefined;
  const res = await safe("supplier-payments", () => listSupplierPayments(db, { status, page, pageSize }), one(sp.fail));
  const canWrite = g.can("purchasing:write");

  const columns: Col<SupplierPaymentRow>[] = [
    { key: "po", header: "Purchase order", cell: (x) => <Link href={`/admin/purchases/${x.purchaseOrderId}`} className="font-medium text-accent hover:underline">{x.poNumber}</Link> },
    { key: "supplier", header: "Supplier", cell: (x) => x.supplierName },
    { key: "total", header: "PO amount", cell: (x) => money(x.totalCents), align: "right" },
    { key: "paid", header: "Amount paid", cell: (x) => money(x.amountPaidCents), align: "right", hideBelow: "sm" },
    { key: "remaining", header: "Remaining", cell: (x) => money(x.remainingCents), align: "right" },
    { key: "due", header: "Due date", cell: (x) => (x.dueDate ? dateShort(x.dueDate) : "—"), hideBelow: "md" },
    { key: "status", header: "Status", cell: (x) => <StatusBadge status={x.status} />, align: "right" },
    ...(canWrite ? [{ key: "actions", header: "", cell: (x: SupplierPaymentRow) => (x.status !== "PAID" && x.status !== "CANCELLED" ? <RecordPaymentForm purchaseOrderId={x.purchaseOrderId} /> : null), align: "right" as const }] : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Supplier payments" description="Every purchase order's payment position.">
        <FinanceNav current="supplier-payments" query={{}} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load supplier payments." /> : (
        <>
          <div className="flex flex-wrap gap-1.5 text-[12.5px]">
            {[undefined, "UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"].map((st) => (
              <a key={st ?? "all"} href={st ? `?status=${st}` : "?"} className={`rounded-md border px-2.5 py-1 font-medium ${status === st || (!status && !st) ? "border-fg bg-fg text-white" : "border-line hover:bg-canvas"}`}>
                {st ? st.charAt(0) + st.slice(1).toLowerCase().replace("_", " ") : "All"}
              </a>
            ))}
          </div>
          <Card>
            <CardBody className="p-0">
              <DataTable columns={columns} rows={res.data.rows} rowKey={(x) => x.purchaseOrderId} basePath="/admin/finance/supplier-payments" params={{ status }}
                empty={<EmptyState title="No purchase orders yet" />} caption="Supplier payments" />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
