"use client";
import { useState, useTransition } from "react";
import { advanceFulfillmentStageAction, createPackageAction, markOrderCompletedAction, setPackageStatusAction, setPickStatusAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { StatusBadge } from "./status-badge";
import { toast } from "./toast";
import type { PackageRow, PickRow } from "@/lib/admin/fulfillment";

const STAGE_LABEL: Record<string, string> = { processing: "Start processing", picking: "Start picking", packing: "Start packing", ready_to_ship: "Mark ready to ship" };

/** One button: the single valid next stage for this order, or nothing once packages exist. */
export function StageControl({ orderId, next }: { orderId: string; next: string | null }) {
  const [pending, start] = useTransition();
  if (!next) return null;
  return (
    <Button variant="primary" disabled={pending}
      onClick={() => start(async () => { const r = await advanceFulfillmentStageAction({ orderId, next: next as "processing" }); if (r.ok) toast(r.message ?? "Updated"); else toast(r.error, false); })}>
      {pending ? "Working…" : STAGE_LABEL[next] ?? `Move to ${next}`}
    </Button>
  );
}

export function MarkCompletedButton({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await markOrderCompletedAction(orderId); if (r.ok) toast(r.message ?? "Done"); else toast(r.error, false); })}>
      {pending ? "Working…" : "Mark completed"}
    </Button>
  );
}

/** Per-line picking control: quantity + Picked/Missing/Damaged (brief §5). */
function PickRowControl({ row }: { row: PickRow }) {
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(row.pickedQuantity || row.quantity);
  const set = (status: "picked" | "missing" | "damaged") => start(async () => {
    const r = await setPickStatusAction({ orderItemId: row.orderItemId, status, pickedQuantity: qty });
    if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false);
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="number" min={0} max={row.quantity} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="h-8 w-16 px-2" aria-label={`Picked quantity for ${row.productName}`} />
      <Button size="sm" variant={row.pickStatus === "picked" ? "primary" : "secondary"} disabled={pending} onClick={() => set("picked")}>Picked</Button>
      <Button size="sm" variant={row.pickStatus === "missing" ? "danger" : "secondary"} disabled={pending} onClick={() => set("missing")}>Missing</Button>
      <Button size="sm" variant={row.pickStatus === "damaged" ? "danger" : "secondary"} disabled={pending} onClick={() => set("damaged")}>Damaged</Button>
    </div>
  );
}

export function PickingList({ picks }: { picks: PickRow[] }) {
  if (!picks.length) return <p className="px-4 py-4 text-[13px] text-muted">Nothing to pick yet.</p>;
  return (
    <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Picking list</caption>
      <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Item</th><th className="px-3 font-medium">Location</th><th className="num px-3 font-medium">Qty</th><th className="px-3 font-medium">Status</th><th className="px-3 pr-4 font-medium">Record</th></tr></thead>
      <tbody>{picks.map((p) => (
        <tr key={p.id} className="border-b border-line-soft last:border-0">
          <td className="py-2.5 pl-4"><p className="font-medium">{p.productName}</p><p className="text-xs text-muted">{p.variant} · {p.sku}</p></td>
          <td className="px-3 text-muted">{p.locationName ?? "—"}</td>
          <td className="num px-3">{p.quantity}</td>
          <td className="px-3"><StatusBadge status={p.pickStatus} /></td>
          <td className="px-3 pr-4"><PickRowControl row={p} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** "Create Shipment" (brief §8): pick which remaining units go in this package, plus optional carrier/tracking. */
export function CreatePackageButton({ orderId, unpackaged }: { orderId: string; unpackaged: { orderItemId: string; productName: string; sku: string; remaining: number }[] }) {
  const [open, setOpen] = useState(false), [pending, start] = useTransition(), [err, setErr] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(unpackaged.map((u) => [u.orderItemId, u.remaining])));
  if (!unpackaged.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="primary" onClick={() => setOpen(true)}>Create shipment</Button>
      <DialogContent title="Create shipment" description="Choose what goes in this package. Leftover units stay available for another package.">
        <form
          className="grid grid-cols-1 gap-3"
          action={(fd) => start(async () => {
            setErr(null);
            const items = unpackaged.filter((u) => (qty[u.orderItemId] ?? 0) > 0).map((u) => ({ orderItemId: u.orderItemId, quantity: qty[u.orderItemId]! }));
            if (!items.length) { setErr("Include at least one item."); return; }
            const r = await createPackageAction({
              orderId, items, carrier: String(fd.get("carrier") ?? "") || undefined, service: String(fd.get("service") ?? "") || undefined,
              trackingNumber: String(fd.get("trackingNumber") ?? "") || undefined, trackingUrl: String(fd.get("trackingUrl") ?? "") || undefined,
              weightGrams: String(fd.get("weight") ?? "") || undefined,
            });
            if (r.ok) { toast(r.message ?? "Created"); setOpen(false); } else setErr(r.error);
          })}
        >
          <div className="grid gap-2 rounded-md border border-line-soft p-3">
            {unpackaged.map((u) => (
              <div key={u.orderItemId} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{u.productName} <span className="text-muted">· {u.sku}</span></span>
                <Input type="number" min={0} max={u.remaining} value={qty[u.orderItemId] ?? 0} onChange={(e) => setQty((s) => ({ ...s, [u.orderItemId]: Number(e.target.value) }))} className="h-8 w-20 px-2" aria-label={`Quantity of ${u.productName}`} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Carrier"><Input name="carrier" placeholder="e.g. UPS, FedEx, USPS, DHL" /></Field>
            <Field label="Service"><Input name="service" placeholder="e.g. Ground, Priority" /></Field>
            <Field label="Tracking number"><Input name="trackingNumber" /></Field>
            <Field label="Weight (grams)"><Input name="weight" type="number" min={0} /></Field>
            <Field label="Custom tracking URL" hint="Only needed for a carrier we don't recognize" className="sm:col-span-2"><Input name="trackingUrl" placeholder="https://…" /></Field>
          </div>
          {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{pending ? "Creating…" : "Create package"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NEXT_SHIP_STATUS: Record<string, { next: string; label: string }[]> = {
  label_created: [{ next: "ready_to_ship", label: "Ready to ship" }, { next: "shipped", label: "Mark shipped" }],
  ready_to_ship: [{ next: "shipped", label: "Mark shipped" }],
  shipped: [{ next: "in_transit", label: "In transit" }, { next: "delivered", label: "Delivered" }, { next: "delivery_failed", label: "Delivery failed" }],
  in_transit: [{ next: "out_for_delivery", label: "Out for delivery" }, { next: "delivered", label: "Delivered" }, { next: "delivery_failed", label: "Delivery failed" }],
  out_for_delivery: [{ next: "delivered", label: "Delivered" }, { next: "delivery_failed", label: "Delivery failed" }],
  delivery_failed: [{ next: "return_to_sender", label: "Return to sender" }, { next: "in_transit", label: "Retry: in transit" }],
};

export function PackageCard({ pkg }: { pkg: PackageRow }) {
  const [pending, start] = useTransition();
  const set = (status: string) => start(async () => { const r = await setPackageStatusAction({ packageId: pkg.id, status: status as "shipped" }); if (r.ok) toast(r.message ?? "Updated"); else toast(r.error, false); });
  const trackingHref = pkg.trackingUrl;
  return (
    <div className="grid gap-2 rounded-md border border-line-soft p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Package {pkg.packageNumber}{pkg.carrier ? ` · ${pkg.carrier}` : ""}{pkg.service ? ` (${pkg.service})` : ""}</p>
        <StatusBadge status={pkg.status} />
      </div>
      {pkg.trackingNumber && <p className="text-muted">{trackingHref ? <a href={trackingHref} target="_blank" rel="noreferrer" className="text-accent hover:underline">{pkg.trackingNumber}</a> : pkg.trackingNumber}</p>}
      <ul className="text-xs text-muted">{pkg.items.map((it) => <li key={it.orderItemId}>{it.quantity}× {it.productName} ({it.sku})</li>)}</ul>
      <div className="flex flex-wrap gap-2">{(NEXT_SHIP_STATUS[pkg.status] ?? []).map((n) => <Button key={n.next} size="sm" disabled={pending} onClick={() => set(n.next)}>{n.label}</Button>)}</div>
    </div>
  );
}

