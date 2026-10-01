"use client";
import { useState, useTransition } from "react";
import {
  createExpenseCategoryAction, setExpenseCategoryActiveAction, createExpenseAction, updateExpenseAction, submitExpenseAction,
  approveExpenseAction, rejectExpenseAction, markExpensePaidAction, cancelExpenseAction, deleteExpenseAction, setTaxSettingsAction,
  runStripeReconciliationAction, recordManualReconciliationAction, markReconciliationReviewedAction, saveReportSnapshotAction,
} from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { toast } from "./toast";
import type { ExpenseRow } from "@/lib/finance/expenses";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);

/* ------------------------------------------------------------------ expense categories */
export function ExpenseCategoryFormButton() {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>New category</Button>
      <DialogContent title="New expense category">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await createExpenseCategoryAction(s(fd, "name"));
          if (r.ok) { setOpen(false); toast(r.message ?? "Created"); } else setErr(r.error);
        })}>
          <Field label="Category name"><Input name="name" required maxLength={80} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Create</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ExpenseCategoryActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await setExpenseCategoryActiveAction(id, !active); if (r.ok) toast(r.message ?? "Updated"); else toast(r.error, false); })}>{active ? "Deactivate" : "Activate"}</Button>;
}

/* ------------------------------------------------------------------ expenses */
export type ExpenseCategoryOption = { id: string; name: string };
export type SupplierOption = { id: string; name: string };
export function ExpenseFormButton({ mode, expense, categories, suppliers }: { mode: "create" | "edit"; expense?: ExpenseRow; categories: ExpenseCategoryOption[]; suppliers: SupplierOption[] }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant={mode === "create" ? "primary" : "secondary"} size={mode === "create" ? "md" : "sm"} onClick={() => setOpen(true)}>{mode === "create" ? "New expense" : "Edit"}</Button>
      <DialogContent title={mode === "create" ? "New expense" : "Edit expense"}>
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const input = {
            categoryId: s(fd, "categoryId"), description: s(fd, "description"), amount: s(fd, "amount"), currency: s(fd, "currency"),
            paymentMethod: s(fd, "paymentMethod"), supplierId: s(fd, "supplierId"), referenceNumber: s(fd, "referenceNumber"),
            notes: s(fd, "notes"), attachmentUrl: s(fd, "attachmentUrl"), expenseDate: s(fd, "expenseDate"),
          };
          const r = mode === "create" ? await createExpenseAction(input as never) : await updateExpenseAction(expense!.id, input as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Category"><Select name="categoryId" defaultValue={expense?.categoryId} required><option value="">Choose</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Date"><Input name="expenseDate" type="date" defaultValue={expense ? new Date(expense.expenseDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Amount (USD)"><Input name="amount" type="number" min={0.01} step="0.01" required defaultValue={expense ? expense.amountCents / 100 : undefined} /></Field>
            <Field label="Currency"><Input name="currency" defaultValue={expense?.currency ?? "USD"} /></Field>
            <Field label="Payment method"><Input name="paymentMethod" placeholder="cash, bank_transfer, card…" defaultValue={expense?.paymentMethod ?? ""} /></Field>
            <Field label="Supplier / vendor (optional)"><Select name="supplierId" defaultValue={expense?.supplierId ?? ""}><option value="">None</option>{suppliers.map((s2) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}</Select></Field>
            <Field label="Reference number"><Input name="referenceNumber" defaultValue={expense?.referenceNumber ?? ""} /></Field>
            <Field label="Attachment URL"><Input name="attachmentUrl" type="url" defaultValue={expense?.attachmentUrl ?? ""} /></Field>
          </div>
          <Field label="Description"><Input name="description" required maxLength={500} defaultValue={expense?.description ?? ""} /></Field>
          <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={expense?.notes ?? ""} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{mode === "create" ? "Create draft" : "Save changes"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NEXT_EXPENSE_STATUS: Record<string, string[]> = { DRAFT: ["PENDING_APPROVAL", "CANCELLED"], PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"], APPROVED: ["PAID", "CANCELLED"], REJECTED: [], PAID: [], CANCELLED: [] };
const LABEL: Record<string, string> = { PENDING_APPROVAL: "Submit for approval", APPROVED: "Approve", REJECTED: "Reject", PAID: "Mark paid", CANCELLED: "Cancel" };
export function ExpenseWorkflowControls({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const options = NEXT_EXPENSE_STATUS[status] ?? [];
  const run = (next: string) => start(async () => {
    const r = next === "PENDING_APPROVAL" ? await submitExpenseAction(id)
      : next === "APPROVED" ? await approveExpenseAction(id)
      : next === "PAID" ? await markExpensePaidAction(id)
      : next === "CANCELLED" ? await cancelExpenseAction(id)
      : { ok: false as const, error: "" };
    if (r.ok) toast(r.message ?? "Updated"); else if (r.error) toast(r.error, false);
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((next) => next === "REJECTED" ? (
        <Button key={next} size="sm" disabled={pending} onClick={() => setRejecting(true)}>Reject</Button>
      ) : (
        <Button key={next} size="sm" variant={next === "APPROVED" || next === "PAID" ? "primary" : "secondary"} disabled={pending} onClick={() => run(next)}>{LABEL[next] ?? next}</Button>
      ))}
      {status === "DRAFT" || status === "PENDING_APPROVAL" || status === "REJECTED" ? (
        <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await deleteExpenseAction(id); if (r.ok) { toast(r.message ?? "Deleted"); window.location.href = "/admin/finance/expenses"; } else toast(r.error, false); })}>Delete</Button>
      ) : null}
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent title="Reject expense">
          <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
            const r = await rejectExpenseAction(id, s(fd, "reason"));
            if (r.ok) { setRejecting(false); toast(r.message ?? "Rejected"); } else toast(r.error, false);
          })}>
            <Field label="Reason"><Textarea name="reason" rows={2} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setRejecting(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Reject</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ tax settings */
export function TaxSettingsForm({ enabled, taxRatePercent, label }: { enabled: boolean; taxRatePercent: number; label: string }) {
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end" action={(fd) => start(async () => {
      const r = await setTaxSettingsAction({ enabled: fd.get("enabled") === "on", taxRatePercent: s(fd, "taxRatePercent"), label: s(fd, "label") } as never);
      if (r.ok) toast(r.message ?? "Saved"); else setErr(r.error);
    })}>
      <Field label="Label"><Input name="label" defaultValue={label} maxLength={80} /></Field>
      <Field label="Rate (%)"><Input name="taxRatePercent" type="number" min={0} max={100} step="0.01" defaultValue={taxRatePercent} /></Field>
      <label className="flex h-9 items-center gap-2 text-[13px]"><input type="checkbox" name="enabled" defaultChecked={enabled} /> Tax enabled</label>
      <div className="sm:col-span-3"><Err e={err} /></div>
      <div className="sm:col-span-3"><Button variant="primary" disabled={pending}>Save</Button></div>
    </form>
  );
}

/* ------------------------------------------------------------------ reconciliation */
export function RunReconciliationButton({ paymentId, provider }: { paymentId: string; provider: string }) {
  const [pending, start] = useTransition();
  if (provider !== "stripe") return null;
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await runStripeReconciliationAction(paymentId); if (r.ok) toast(r.message ?? "Checked"); else toast(r.error, false); })}>Check against Stripe</Button>;
}
export function ManualReconciliationButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Enter external amount</Button>
      <DialogContent title="Manual reconciliation">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await recordManualReconciliationAction({ paymentId, externalAmount: s(fd, "externalAmount"), notes: s(fd, "notes") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Recorded"); } else setErr(r.error);
        })}>
          <Field label="External amount (USD) — leave blank if no provider record exists"><Input name="externalAmount" type="number" min={0} step="0.01" /></Field>
          <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function MarkReviewedButton({ id }: { id: string | null }) {
  const [pending, start] = useTransition();
  if (!id) return null;
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await markReconciliationReviewedAction(id); if (r.ok) toast(r.message ?? "Marked reviewed"); else toast(r.error, false); })}>Mark reviewed</Button>;
}

/* ------------------------------------------------------------------ report snapshots */
export function SaveSnapshotButton({ reportType, from, to }: { reportType: string; from: string; to: string }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Save snapshot</Button>
      <DialogContent title="Save report snapshot">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await saveReportSnapshotAction({ reportType, label: s(fd, "label"), from, to } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); } else setErr(r.error);
        })}>
          <Field label="Name"><Input name="label" required maxLength={160} placeholder="September 2026 Management P&L" /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
