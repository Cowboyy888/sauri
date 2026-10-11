"use client";
import { useRef, useState, useTransition } from "react";
import { addStaffAction, createDiscountAction, toggleDiscountAction, updateContentAction, updateStaffAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { toast } from "./toast";
import { uploadProductImages } from "@/lib/supabase/upload-images";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);

export function NewDiscountButton({ categories }: { categories: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition(), [type, setType] = useState("percent");
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant="primary" onClick={() => setOpen(true)}>New discount</Button>
      <DialogContent title="New discount" description="Checked on the server at checkout: dates, limits, minimum and eligible products.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await createDiscountAction({ code: s(fd, "code"), type: s(fd, "type") as "percent", value: s(fd, "value") || "0", categoryId: s(fd, "categoryId"), minSubtotal: s(fd, "min"), maxDiscount: s(fd, "max"), startsAt: s(fd, "start"), endsAt: s(fd, "end"), usageLimit: s(fd, "limit"), perCustomerLimit: s(fd, "per") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Created"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code"><Input name="code" required pattern="[A-Za-z0-9]{3,20}" style={{ textTransform: "uppercase" }} placeholder="SUMMER15" /></Field>
            <Field label="Type"><Select name="type" value={type} onChange={(e) => setType(e.target.value)}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option><option value="free_shipping">Free shipping</option></Select></Field>
            {type !== "free_shipping" && <Field label={type === "percent" ? "Percent off" : "Amount off (USD)"}><Input name="value" type="number" min={type === "percent" ? 1 : 0.01} max={type === "percent" ? 100 : undefined} step={type === "percent" ? 1 : "0.01"} required /></Field>}
            <Field label="Applies to"><Select name="categoryId"><option value="">All products</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}</Select></Field>
            <Field label="Minimum order (USD)"><Input name="min" type="number" min={0} step="0.01" /></Field>
            <Field label="Maximum discount (USD)"><Input name="max" type="number" min={0} step="0.01" /></Field>
            <Field label="Starts"><Input name="start" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Ends"><Input name="end" type="date" /></Field>
            <Field label="Total uses"><Input name="limit" type="number" min={1} placeholder="Unlimited" /></Field>
            <Field label="Uses per customer"><Input name="per" type="number" min={1} placeholder="Unlimited" /></Field>
          </div>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Create discount</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function DiscountToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await toggleDiscountAction(id, !active); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); })}>{active ? "Pause" : "Activate"}</Button>;
}

export function ContentForm({ v }: { v: { announce: string; heroTitle: string; heroLede: string; heroImage: string } }) {
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  const [heroImage, setHeroImage] = useState(v.heroImage), [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null); setUploading(true);
    try { const [url] = await uploadProductImages([file], "site/hero"); if (url) setHeroImage(url); }
    catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  return (
    <form className="grid max-w-2xl gap-3.5" action={(fd) => start(async () => { setErr(null); const r = await updateContentAction({ announce: s(fd, "announce"), heroTitle: s(fd, "heroTitle"), heroLede: s(fd, "heroLede"), heroImage }); if (r.ok) toast("Published to the storefront"); else setErr(r.error); })}>
      <div className="grid gap-2">
        <span className="text-[13px] font-medium">Homepage hero photo</span>
        <div className="relative aspect-[16/7] w-full overflow-hidden rounded-md border border-line bg-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {heroImage ? <img src={heroImage} alt="Hero preview" className="h-full w-full object-cover" /> : <span className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted">Using the default photo. Upload one to replace it.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" id="hero-photo" onChange={(e) => pick(e.target.files?.[0])} />
          <Button type="button" variant="secondary" disabled={uploading || pending} onClick={() => fileRef.current?.click()}>{uploading ? "Uploading…" : heroImage ? "Replace photo" : "Upload photo"}</Button>
          {heroImage && <Button type="button" variant="ghost" disabled={uploading || pending} onClick={() => setHeroImage("")}>Use default</Button>}
          <span className="text-xs text-muted">Wide landscape works best (about 2400×1200). JPG, PNG, WebP or AVIF, up to 5 MB. Shown after you publish.</span>
        </div>
      </div>
      <Field label="Announcement bar" hint="Up to 120 characters"><Input name="announce" defaultValue={v.announce} maxLength={120} /></Field>
      <Field label="Homepage headline" hint="Up to 60 characters"><Input name="heroTitle" defaultValue={v.heroTitle} maxLength={60} /></Field>
      <Field label="Homepage introduction" hint="Up to 300 characters"><Textarea name="heroLede" rows={3} defaultValue={v.heroLede} maxLength={300} /></Field>
      <Err e={err} />
      <Button variant="primary" disabled={pending} className="justify-self-start">Publish changes</Button>
    </form>
  );
}

const ROLES = ["OWNER", "ADMIN", "SALES", "INVENTORY", "VIEWER"];
export function StaffRow({ u, self }: { u: { id: string; name: string; email: string; role: string; active: boolean; linked: boolean }; self: boolean }) {
  const [pending, start] = useTransition();
  const run = (patch: { role?: string; active?: boolean }) => start(async () => { const r = await updateStaffAction(u.id, patch); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); });
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2.5 pl-4"><p className="font-medium">{u.name}{self && <span className="ml-1.5 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{u.email}</p></td>
      <td className="px-3"><select aria-label={`Role for ${u.name}`} defaultValue={u.role} disabled={pending || self} onChange={(e) => run({ role: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2 text-[13px]">{ROLES.map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>)}</select></td>
      <td className="hidden px-3 text-xs text-muted sm:table-cell">{u.linked ? "Signed in before" : "Not yet signed in"}</td>
      <td className="px-3 pr-4 text-right">{!self && <Button size="sm" variant={u.active ? "danger" : "secondary"} disabled={pending} onClick={() => run({ active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</Button>}</td>
    </tr>
  );
}
export function AddStaffForm() {
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-3 border-t border-line-soft p-4 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end" action={(fd) => start(async () => { setErr(null); const r = await addStaffAction({ email: s(fd, "email"), name: s(fd, "name"), role: s(fd, "role") }); if (r.ok) toast(r.message ?? "Added"); else setErr(r.error); })}>
      <Field label="Name"><Input name="name" required /></Field>
      <Field label="Email"><Input name="email" type="email" required /></Field>
      <Field label="Role"><Select name="role" defaultValue="VIEWER">{ROLES.filter((r) => r !== "OWNER").map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>)}</Select></Field>
      <Button disabled={pending}>Add staff</Button>
      <div className="sm:col-span-4"><Err e={err} /></div>
    </form>
  );
}
