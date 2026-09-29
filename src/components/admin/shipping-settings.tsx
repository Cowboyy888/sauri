"use client";
import { useState, useTransition } from "react";
import { saveShippingMethodAction, toggleShippingMethodAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { StatusBadge } from "./status-badge";
import { money } from "@/lib/format";
import { toast } from "./toast";

export type ShippingMethodRow = {
  id: string; name: string; description: string; priceCents: number; estimatedMinDays: number; estimatedMaxDays: number;
  waivableAboveThreshold: boolean; carrierCostCents: number; countryCode: string | null; region: string | null;
  minOrderCents: number | null; maxOrderCents: number | null; active: boolean;
};

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);
const Check = ({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) => (
  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[#2f5d50]" />{label}</label>
);

function MethodForm({ method, onDone }: { method?: ShippingMethodRow; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-1 gap-3"
      action={(fd) => start(async () => {
        setErr(null);
        const r = await saveShippingMethodAction({
          id: method?.id, name: s(fd, "name"), description: s(fd, "description"), price: s(fd, "price") || "0",
          estimatedMinDays: s(fd, "min") || "0", estimatedMaxDays: s(fd, "max") || "0", waivableAboveThreshold: fd.get("waivable") === "on",
          carrierCost: s(fd, "carrierCost"), countryCode: s(fd, "countryCode"), region: s(fd, "region"), minOrder: s(fd, "minOrder"), maxOrder: s(fd, "maxOrder"), active: fd.get("active") === "on",
        } as never);
        if (r.ok) { toast(r.message ?? "Saved"); onDone(); } else setErr(r.error);
      })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name"><Input name="name" required defaultValue={method?.name} placeholder="e.g. Standard, Express, Local Pickup" /></Field>
        <Field label="Price (USD)"><Input name="price" type="number" min={0} step="0.01" required defaultValue={method ? (method.priceCents / 100).toFixed(2) : undefined} /></Field>
        <Field label="Min delivery days"><Input name="min" type="number" min={0} max={90} required defaultValue={method?.estimatedMinDays} /></Field>
        <Field label="Max delivery days"><Input name="max" type="number" min={0} max={90} required defaultValue={method?.estimatedMaxDays} /></Field>
        <Field label="Carrier cost (internal, USD)" hint="What we pay the carrier — never shown to the customer"><Input name="carrierCost" type="number" min={0} step="0.01" defaultValue={method ? (method.carrierCostCents / 100).toFixed(2) : undefined} /></Field>
        <div className="grid content-end gap-2 pb-1">
          <Check name="waivable" label="Waived above the free-shipping threshold" defaultChecked={method?.waivableAboveThreshold} />
          <Check name="active" label="Active (selectable at checkout)" defaultChecked={method?.active ?? true} />
        </div>
        <Field label="Restrict to country code" hint="ISO 2-letter, e.g. US — blank means all countries"><Input name="countryCode" maxLength={2} defaultValue={method?.countryCode ?? ""} /></Field>
        <Field label="Restrict to region/state" hint="Blank means all regions within the country"><Input name="region" defaultValue={method?.region ?? ""} /></Field>
        <Field label="Minimum order (USD)" hint="Blank means no minimum"><Input name="minOrder" type="number" min={0} step="0.01" defaultValue={method?.minOrderCents != null ? (method.minOrderCents / 100).toFixed(2) : ""} /></Field>
        <Field label="Maximum order (USD)" hint="Blank means no maximum"><Input name="maxOrder" type="number" min={0} step="0.01" defaultValue={method?.maxOrderCents != null ? (method.maxOrderCents / 100).toFixed(2) : ""} /></Field>
      </div>
      <Field label="Description" className="sm:col-span-2"><Input name="description" maxLength={300} defaultValue={method?.description} placeholder="Shown to customers at checkout" /></Field>
      <Err e={err} />
      <div className="flex justify-end gap-2"><Button type="button" onClick={onDone}>Cancel</Button><Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : method ? "Save changes" : "Create method"}</Button></div>
    </form>
  );
}

export function NewShippingMethodButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="primary" onClick={() => setOpen(true)}>New shipping method</Button>
      <DialogContent title="New shipping method" description="Configurable per brief §15 — never hardcoded. Restrict by geography or order value if needed.">
        <MethodForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function ShippingMethodRowActions({ method }: { method: ShippingMethodRow }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-end gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <Button size="sm" onClick={() => setOpen(true)}>Edit</Button>
        <DialogContent title={`Edit ${method.name}`}>
          <MethodForm method={method} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      <Button size="sm" variant={method.active ? "danger" : "secondary"} disabled={pending}
        onClick={() => start(async () => { const r = await toggleShippingMethodAction(method.id, !method.active); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); })}>
        {method.active ? "Deactivate" : "Activate"}
      </Button>
    </div>
  );
}

export function ShippingMethodSummary({ method }: { method: ShippingMethodRow }) {
  const bits = [
    method.countryCode ? `${method.countryCode} only` : null,
    method.region ? `${method.region} only` : null,
    method.minOrderCents != null ? `min ${money(method.minOrderCents)}` : null,
    method.maxOrderCents != null ? `max ${money(method.maxOrderCents)}` : null,
    method.waivableAboveThreshold ? "waived above threshold" : null,
  ].filter(Boolean);
  return bits.length ? <p className="text-xs text-muted">{bits.join(" · ")}</p> : <StatusBadge status="active" label="No restrictions" className="bg-line-soft text-muted" />;
}
