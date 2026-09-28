"use client";
import { useState, useTransition } from "react";
import { updateOrderStatusAction } from "@/app/admin/actions";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Select, Textarea } from "../ui/field";
import { toast } from "./toast";

const LABEL: Record<string, string> = { processing: "Mark as processing", shipped: "Mark as shipped", delivered: "Mark as delivered", cancelled: "Cancel order", refunded: "Refund order" };

/** Only the transitions allowed from the current status are offered; the server enforces the same rule. */
export function OrderStatusControl({ orderId, orderNumber, next, totalLabel }: { orderId: string; orderNumber: string; next: string[]; totalLabel: string }) {
  const [pending, start] = useTransition(), [confirm, setConfirm] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const run = (status: string, extra: { reason?: string; restock?: boolean } = {}) => start(async () => {
    const r = await updateOrderStatusAction({ orderId, status: status as "shipped", ...extra });
    if (r.ok) { setConfirm(null); toast(`${orderNumber}: ${LABEL[status]!.toLowerCase().replace(/^mark as /, "")}`); } else { setErr(r.error); toast(r.error, false); }
  });
  if (!next.length) return <p className="text-[13px] text-muted">This order is closed. No further status changes.</p>;
  const forward = next.filter((s) => s !== "cancelled" && s !== "refunded"), destructive = next.filter((s) => s === "cancelled" || s === "refunded");
  return (
    <div className="grid grid-cols-1 gap-2">
      {forward.map((s) => <Button key={s} variant="primary" disabled={pending} onClick={() => run(s)}>{LABEL[s]}</Button>)}
      <div className="flex flex-wrap gap-2">{destructive.map((s) => <Button key={s} variant="danger" size="sm" disabled={pending} onClick={() => { setErr(null); setConfirm(s); }}>{LABEL[s]}</Button>)}</div>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent title={confirm === "refunded" ? `Refund ${orderNumber}?` : `Cancel ${orderNumber}?`} description={confirm === "refunded" ? `Refunds the merchandise (${totalLabel} order). Revenue, COGS and profit update immediately.` : "Paid orders are refunded; unpaid orders release their reserved stock."}>
          <form className="grid grid-cols-1 gap-3.5" action={(fd) => run(confirm!, { reason: String(fd.get("reason") ?? ""), restock: fd.get("restock") === "yes" })}>
            <Field label="Reason"><Textarea name="reason" rows={2} placeholder="e.g. Customer changed mind" /></Field>
            <Field label="Stock"><Select name="restock" defaultValue="yes"><option value="yes">Return items to stock</option><option value="no">Don’t restock (damaged or lost), the cost stays as a loss</option></Select></Field>
            {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setConfirm(null)}>Keep order</Button><Button variant="danger" disabled={pending}>{pending ? "Working…" : confirm === "refunded" ? "Refund" : "Cancel order"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
