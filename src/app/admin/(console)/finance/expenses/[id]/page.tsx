import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getExpense } from "@/lib/finance/expenses";
import { listExpenseCategories } from "@/lib/finance/expense-categories";
import { listSuppliers } from "@/lib/purchasing/suppliers";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { money, dateShort, dateTimeFull } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { ExpenseFormButton, ExpenseWorkflowControls } from "@/components/admin/finance-forms";

export const metadata = { title: "Expense" };

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params, db = getDb();
  const res = await safe("expense", async () => {
    const [row, categories, suppliers] = await Promise.all([getExpense(db, id), listExpenseCategories(db), listSuppliers(db)]);
    return { row, categories, suppliers };
  });
  if (!res.ok) return <EmptyState title="Unable to load this expense." />;
  if (!res.data.row) notFound();
  const { e, category, supplierName, createdBy } = res.data.row;
  const canWrite = g.can("finance:write");

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title={e.expenseNumber} description={e.description} actions={canWrite && e.status === "DRAFT" ? <ExpenseFormButton mode="edit" expense={e} categories={res.data.categories} suppliers={res.data.suppliers} /> : null} />
      <Card>
        <CardHeader title="Details" />
        <CardBody className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-3">
          <div><p className="text-xs text-muted">Status</p><StatusBadge status={e.status} /></div>
          <div><p className="text-xs text-muted">Amount</p><p className="font-semibold">{money(e.amountCents)} {e.currency}</p></div>
          <div><p className="text-xs text-muted">Category</p><p>{category}</p></div>
          <div><p className="text-xs text-muted">Date</p><p>{dateShort(e.expenseDate)}</p></div>
          <div><p className="text-xs text-muted">Payment method</p><p>{e.paymentMethod ?? "—"}</p></div>
          <div><p className="text-xs text-muted">Supplier / vendor</p><p>{supplierName ?? "—"}</p></div>
          <div><p className="text-xs text-muted">Reference number</p><p>{e.referenceNumber ?? "—"}</p></div>
          <div><p className="text-xs text-muted">Created by</p><p>{createdBy ?? "—"} · {dateTimeFull(e.createdAt)}</p></div>
          {e.approvedAt && <div><p className="text-xs text-muted">Approved</p><p>{dateTimeFull(e.approvedAt)}</p></div>}
          {e.rejectedReason && <div className="col-span-full"><p className="text-xs text-muted">Rejection reason</p><p>{e.rejectedReason}</p></div>}
          {e.paidAt && <div><p className="text-xs text-muted">Paid</p><p>{dateTimeFull(e.paidAt)}</p></div>}
          {e.attachmentUrl && <div><p className="text-xs text-muted">Attachment</p><a href={e.attachmentUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">View</a></div>}
          {e.notes && <div className="col-span-full"><p className="text-xs text-muted">Notes</p><p className="whitespace-pre-wrap">{e.notes}</p></div>}
        </CardBody>
      </Card>
      {canWrite && <Card><CardHeader title="Workflow" /><CardBody><ExpenseWorkflowControls id={e.id} status={e.status} /></CardBody></Card>}
    </div>
  );
}
