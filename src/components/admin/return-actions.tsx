"use client";
import { useState, useTransition } from "react";
import { recordInspectionAction, refundReturnAction, requestReturnInfoAction, setReturnShippingAction, updateReturnStatusAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { toast } from "./toast";

const LABEL: Record<string, string> = {
  under_review: "Move to review", approved: "Approve", rejected: "Reject", return_shipped: "Mark return shipped",
  received: "Mark received", inspecting: "Start inspection", approved_for_refund: "Approve refund", closed: "Close",
};
const NEEDS_NOTE = new Set(["rejected"]);

export function ReturnStatusActions({ returnRequestId, status, next }: { returnRequestId: string; status: string; next: string[] }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = (nextStatus: string, note?: string) => start(async () => {
    const r = await updateReturnStatusAction({ returnRequestId, next: nextStatus as "approved", note });
    if (r.ok) { setConfirm(null); toast(r.message ?? "Updated"); } else { setErr(r.error); toast(r.error, false); }
  });
  if (!next.length) return <p className="text-[13px] text-muted">{status === "refunded" ? "Refunded — nothing left to do but close it." : status === "closed" ? "Closed." : "No further status changes."}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {next.map((s) => (
        <Button key={s} size="sm" variant={s === "rejected" ? "danger" : s === "approved" || s === "approved_for_refund" ? "primary" : "secondary"} disabled={pending}
          onClick={() => (NEEDS_NOTE.has(s) ? setConfirm(s) : run(s))}>
          {LABEL[s] ?? s}
        </Button>
      ))}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent title="Reject this return" description="The customer will be emailed with this reason.">
          <form className="grid grid-cols-1 gap-3" action={(fd) => run(confirm!, String(fd.get("note") ?? ""))}>
            <Field label="Reason"><Textarea name="note" rows={3} required /></Field>
            {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" disabled={pending}>{pending ? "Working…" : "Reject"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RequestInfoButton({ returnRequestId }: { returnRequestId: string }) {
  const [open, setOpen] = useState(false), [pending, start] = useTransition(), [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>Request more information</Button>
      <DialogContent title="Request more information" description="Logged on the return's timeline — doesn't change its status.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await requestReturnInfoAction({ returnRequestId, note: String(fd.get("note") ?? "") });
          if (r.ok) { toast(r.message ?? "Sent"); setOpen(false); } else setErr(r.error);
        })}>
          <Field label="What do you need from the customer?"><Textarea name="note" rows={3} required /></Field>
          {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{pending ? "Sending…" : "Send"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnShippingForm({ returnRequestId, trackingNumber, carrier }: { returnRequestId: string; trackingNumber: string | null; carrier: string | null }) {
  const [pending, start] = useTransition();
  const [tn, setTn] = useState(trackingNumber ?? ""), [c, setC] = useState(carrier ?? "");
  return (
    <form className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]" action={() => start(async () => {
      const r = await setReturnShippingAction({ returnRequestId, trackingNumber: tn || undefined, carrier: c || undefined });
      if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false);
    })}>
      <Field label="Carrier"><Input value={c} onChange={(e) => setC(e.target.value)} /></Field>
      <Field label="Tracking number"><Input value={tn} onChange={(e) => setTn(e.target.value)} /></Field>
      <Button type="submit" disabled={pending} className="self-end">{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

const CONDITIONS = ["new", "like_new", "used", "damaged", "defective", "unsellable"];
const DISPOSITIONS = ["restock", "repair", "damaged", "dispose", "return_to_customer"];

export function InspectionForm({ returnItemId, productName }: { returnItemId: string; productName: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [disposition, setDisposition] = useState("restock");
  return (
    <form
      className="grid grid-cols-1 gap-2 rounded-md border border-line-soft p-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
      action={(fd) => start(async () => {
        setErr(null);
        const r = await recordInspectionAction({ returnItemId, condition: String(fd.get("condition")) as "new", disposition: String(fd.get("disposition")) as "restock", notes: String(fd.get("notes") ?? "") || undefined });
        if (r.ok) toast(r.message ?? "Recorded"); else setErr(r.error);
      })}
    >
      <Field label={`Condition — ${productName}`}><Select name="condition" defaultValue="new">{CONDITIONS.map((c) => <option key={c} value={c}>{c.split("_").join(" ")}</option>)}</Select></Field>
      <Field label="Disposition"><Select name="disposition" value={disposition} onChange={(e) => setDisposition(e.target.value)}>{DISPOSITIONS.map((d) => <option key={d} value={d}>{d.split("_").join(" ")}</option>)}</Select></Field>
      <Field label="Notes"><Input name="notes" placeholder="Optional" /></Field>
      <Button type="submit" variant={disposition === "restock" ? "primary" : "secondary"} disabled={pending}>{pending ? "Saving…" : "Record inspection"}</Button>
      {err && <p role="alert" className="text-[13px] text-neg sm:col-span-4">{err}</p>}
    </form>
  );
}

export function RefundReturnButton({ returnRequestId, amountLabel }: { returnRequestId: string; amountLabel: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await refundReturnAction(returnRequestId); if (r.ok) toast(r.message ?? "Refunded"); else toast(r.error, false); })}>
      {pending ? "Processing…" : `Refund ${amountLabel}`}
    </Button>
  );
}
