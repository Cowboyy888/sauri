"use client";
import { useState, useTransition } from "react";
import {
  addCustomerNoteAction, adjustPointsAction, anonymizeCustomerAction, assignTagAction, createTagAction,
  logCommunicationAction, mergeCustomersAction, unassignTagAction,
} from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { dateTimeFull } from "@/lib/format";
import { toast } from "./toast";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);

/* ------------------------------------------------------------------------- tags */
export function CustomerTags({ customerId, current, allTags }: { customerId: string; current: { id: string; name: string; color: string | null }[]; allTags: { id: string; name: string; color: string | null }[] }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const available = allTags.filter((t) => !current.some((c) => c.id === t.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {current.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: (t.color ?? "#888") + "22", color: t.color ?? undefined }}>
          {t.name}
          <button type="button" disabled={pending} aria-label={`Remove ${t.name}`} onClick={() => start(async () => { const r = await unassignTagAction(customerId, t.id); if (!r.ok) toast(r.error, false); })} className="hover:opacity-70">×</button>
        </span>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <Button size="sm" onClick={() => setOpen(true)}>+ Tag</Button>
        <DialogContent title="Add a tag">
          <div className="grid gap-3">
            {available.length > 0 && <div className="flex flex-wrap gap-1.5">{available.map((t) => (
              <Button key={t.id} size="sm" disabled={pending} onClick={() => start(async () => { const r = await assignTagAction(customerId, t.id); if (r.ok) { toast("Tag added"); setOpen(false); } else toast(r.error, false); })}>{t.name}</Button>
            ))}</div>}
            <form className="flex gap-2" action={(fd) => start(async () => {
              const r = await createTagAction({ name: s(fd, "name") });
              if (r.ok) toast("Tag created — add it from the list above"); else toast(r.error, false);
            })}>
              <Input name="name" placeholder="New tag name" className="flex-1" />
              <Button type="submit" disabled={pending}>Create</Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------------ notes */
export function CustomerNotes({ customerId, notes }: { customerId: string; notes: { id: string; note: string; author: string; createdAt: Date }[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      {notes.length ? <ul className="grid gap-2">{notes.map((n) => (
        <li key={n.id} className="rounded-md bg-canvas p-2.5 text-[13px]"><p className="whitespace-pre-wrap">{n.note}</p><p className="mt-1 text-xs text-muted">{n.author} · {dateTimeFull(n.createdAt)}</p></li>
      ))}</ul> : <p className="text-[13px] text-muted">No notes yet.</p>}
      <form className="grid gap-2" action={(fd) => start(async () => {
        const r = await addCustomerNoteAction({ customerId, note: s(fd, "note") });
        if (r.ok) toast("Note added"); else toast(r.error, false);
      })}>
        <Textarea name="note" rows={2} placeholder="Add an internal note — never shown to the customer" />
        <Button type="submit" size="sm" disabled={pending} className="justify-self-start">Add note</Button>
      </form>
    </div>
  );
}

/* --------------------------------------------------------------- communications */
const TYPES = [["email", "Email"], ["sms", "SMS"], ["call", "Call"], ["whatsapp", "WhatsApp"], ["telegram", "Telegram"], ["note", "Note"]] as const;
export function CustomerCommunications({ customerId, items }: { customerId: string; items: { id: string; type: string; subject: string | null; message: string; author: string; createdAt: Date }[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      {items.length ? <ul className="grid gap-2">{items.map((c) => (
        <li key={c.id} className="rounded-md bg-canvas p-2.5 text-[13px]">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{c.type}{c.subject ? ` · ${c.subject}` : ""}</p>
          <p className="mt-0.5 whitespace-pre-wrap">{c.message}</p>
          <p className="mt-1 text-xs text-muted">{c.author} · {dateTimeFull(c.createdAt)}</p>
        </li>
      ))}</ul> : <p className="text-[13px] text-muted">No communication logged yet.</p>}
      <form className="grid gap-2" action={(fd) => start(async () => {
        const r = await logCommunicationAction({ customerId, type: s(fd, "type") as "email", subject: s(fd, "subject") || undefined, message: s(fd, "message") });
        if (r.ok) toast("Logged"); else toast(r.error, false);
      })}>
        <div className="grid grid-cols-[140px_1fr] gap-2"><Select name="type" defaultValue="call">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select><Input name="subject" placeholder="Subject (optional)" /></div>
        <Textarea name="message" rows={2} placeholder="What was discussed" />
        <Button type="submit" size="sm" disabled={pending} className="justify-self-start">Log communication</Button>
      </form>
    </div>
  );
}

/* --------------------------------------------------------------------- loyalty */
export function AdjustPointsForm({ customerId }: { customerId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid grid-cols-1 gap-2 sm:grid-cols-[100px_1fr_auto]" action={(fd) => start(async () => {
      setErr(null);
      const r = await adjustPointsAction({ customerId, points: s(fd, "points") || "0", reason: s(fd, "reason") });
      if (r.ok) toast("Points adjusted"); else setErr(r.error);
    })}>
      <Input name="points" type="number" placeholder="±points" required />
      <Input name="reason" placeholder="Reason (required, e.g. goodwill)" required />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Adjust"}</Button>
      <Err e={err} />
    </form>
  );
}

/* ----------------------------------------------------------------------- merge */
export function MergeCustomerButton({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false), [pending, start] = useTransition(), [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>Merge into another customer</Button>
      <DialogContent title="Merge customers" description="Every order, address, wishlist item, review, note and loyalty balance moves to the customer id you enter below. This customer's row is kept but marked merged — nothing is deleted.">
        <form className="grid gap-3" action={(fd) => start(async () => {
          setErr(null);
          const r = await mergeCustomersAction({ survivorId: s(fd, "survivorId"), loserId: customerId });
          if (r.ok) { toast("Merged"); setOpen(false); window.location.href = `/admin/customers/${s(fd, "survivorId")}`; } else setErr(r.error);
        })}>
          <Field label="Surviving customer's ID" hint="Copy it from the other customer's page URL"><Input name="survivorId" required /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" disabled={pending}>{pending ? "Merging…" : "Merge"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AnonymizeCustomerButton({ customerId }: { customerId: string }) {
  const [confirming, setConfirming] = useState(false), [pending, start] = useTransition();
  if (!confirming) return <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>Anonymize (privacy request)</Button>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[13px] text-muted">Replace this customer&rsquo;s name, email, phone and addresses permanently?</span>
      <Button size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
      <Button size="sm" variant="danger" disabled={pending} onClick={() => start(async () => { const r = await anonymizeCustomerAction(customerId); if (r.ok) { toast("Anonymized"); window.location.reload(); } else toast(r.error, false); })}>{pending ? "Working…" : "Confirm"}</Button>
    </span>
  );
}
