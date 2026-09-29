"use client";
import { useState, useTransition } from "react";
import { addOrderNoteAction, refundOrderAction, setTrackingAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Textarea } from "../ui/field";
import { toast } from "./toast";

export function TrackingForm({ orderId, trackingNumber, carrier }: { orderId: string; trackingNumber: string | null; carrier: string | null }) {
  const [pending, start] = useTransition();
  const [tn, setTn] = useState(trackingNumber ?? "");
  const [c, setC] = useState(carrier ?? "");
  return (
    <form
      className="grid grid-cols-1 gap-2"
      action={() => start(async () => {
        const r = await setTrackingAction({ orderId, trackingNumber: tn, carrier: c || undefined });
        if (r.ok) toast("Tracking added"); else toast(r.error, false);
      })}
    >
      <Field label="Carrier"><Input value={c} onChange={(e) => setC(e.target.value)} placeholder="e.g. DHL, USPS" /></Field>
      <Field label="Tracking number"><Input value={tn} onChange={(e) => setTn(e.target.value)} required /></Field>
      <Button type="submit" variant="primary" disabled={pending || !tn.trim()}>{pending ? "Saving…" : trackingNumber ? "Update tracking" : "Add tracking"}</Button>
    </form>
  );
}

export function PartialRefundForm({ orderId, refundableCents }: { orderId: string; refundableCents: number }) {
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (refundableCents <= 0) return null;
  return (
    <form
      className="grid grid-cols-1 gap-2"
      action={() => start(async () => {
        setErr(null);
        const r = await refundOrderAction({ orderId, amount, reason: reason || undefined });
        if (r.ok) { toast("Refund processed"); setAmount(""); setReason(""); } else { setErr(r.error); toast(r.error, false); }
      })}
    >
      <Field label={`Refund amount (up to ${(refundableCents / 100).toFixed(2)})`} error={err}>
        <Input type="number" min="0.01" max={(refundableCents / 100).toFixed(2)} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
      <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Partial return, goodwill" /></Field>
      <Button type="submit" variant="danger" disabled={pending || !amount}>{pending ? "Processing…" : "Issue refund"}</Button>
    </form>
  );
}

export function OrderNotes({ orderId, notes }: { orderId: string; notes: string | null }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  return (
    <div className="grid grid-cols-1 gap-3">
      {notes ? <pre className="whitespace-pre-wrap rounded-md bg-canvas p-3 text-[12.5px] text-muted">{notes}</pre> : <p className="text-[13px] text-muted">No internal notes yet.</p>}
      <form
        className="grid grid-cols-1 gap-2"
        action={() => start(async () => {
          const r = await addOrderNoteAction({ orderId, note });
          if (r.ok) { toast("Note added"); setNote(""); } else toast(r.error, false);
        })}
      >
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note — never shown to the customer" />
        <Button type="submit" size="sm" disabled={pending || !note.trim()}>{pending ? "Saving…" : "Add note"}</Button>
      </form>
    </div>
  );
}
