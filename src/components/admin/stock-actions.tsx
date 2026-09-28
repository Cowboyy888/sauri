"use client";
import { useState, useTransition } from "react";
import { PackagePlus, SlidersHorizontal } from "lucide-react";
import { adjustStockAction, restockAction } from "@/app/admin/actions";
import { Dialog, DialogContent, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { toast } from "./toast";
import { money } from "@/lib/format";

export type StockTarget = { variantId: string; productName: string; label: string; sku: string; stockQuantity: number; reservedQuantity: number; availableStock: number; reorderLevel: number; costPriceCents: number; suggestedReorderQuantity?: number };

/** §22 RESTOCK: one server transaction → inventory, RESTOCK movement, weighted-average cost, audit log, dashboard refresh. */
export function RestockButton({ target, suppliers, size = "sm", label = "Restock", variant = "secondary" }: { target: StockTarget; suppliers: string[]; size?: "sm" | "md"; label?: string; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <DialogTrigger asChild><Button size={size} variant={variant} aria-label={`${label} ${target.sku}`} title={label}><PackagePlus /><span className="max-sm:sr-only">{label}</span></Button></DialogTrigger>
      <DialogContent title="Restock" description={`${target.productName}, ${target.label} (${target.sku})`}>
        <form className="grid grid-cols-1 gap-3.5" action={(fd) => start(async () => {
          const r = await restockAction({ variantId: target.variantId, quantity: fd.get("quantity") as string, unitCost: fd.get("unitCost") as string, supplierName: fd.get("supplier") as string, reference: fd.get("reference") as string, notes: fd.get("notes") as string } as never);
          if (r.ok) { setOpen(false); toast(`${target.sku}: +${fd.get("quantity")} units received`); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-3 gap-2 rounded-md bg-canvas p-3 text-center text-xs">
            <div><p className="text-muted">In stock</p><p className="text-[15px] font-semibold">{target.stockQuantity}</p></div>
            <div><p className="text-muted">Available</p><p className="text-[15px] font-semibold">{target.availableStock}</p></div>
            <div><p className="text-muted">Reorder level</p><p className="text-[15px] font-semibold">{target.reorderLevel}</p></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Quantity received"><Input name="quantity" type="number" inputMode="numeric" min={1} step={1} required defaultValue={target.suggestedReorderQuantity || undefined} autoFocus /></Field>
            <Field label="Unit cost (USD)" hint={`Current cost ${money(target.costPriceCents)}`}><Input name="unitCost" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={(target.costPriceCents / 100).toFixed(2)} /></Field>
          </div>
          <Field label="Supplier"><Input name="supplier" list="suppliers" placeholder="Choose or type a supplier" /></Field>
          <datalist id="suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          <Field label="Reference" hint="Purchase order or invoice number"><Input name="reference" placeholder="PO-4210" /></Field>
          <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
          <p className="text-xs text-muted">A different unit cost updates this variant’s cost as a weighted average of old and new stock.</p>
          {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Add to stock"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustButton({ target }: { target: StockTarget }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <DialogTrigger asChild><Button size="sm" variant="ghost" aria-label={`Adjust stock for ${target.sku}`}><SlidersHorizontal /><span className="hidden sm:inline">Adjust</span></Button></DialogTrigger>
      <DialogContent title="Adjust stock" description={`${target.productName}, ${target.label} (${target.sku})`}>
        <form className="grid grid-cols-1 gap-3.5" action={(fd) => start(async () => {
          const r = await adjustStockAction({ variantId: target.variantId, newStockQuantity: fd.get("newStock") as string, movementType: fd.get("reason") as "ADJUSTMENT", notes: fd.get("notes") as string, reorderLevel: fd.get("reorder") as string } as never);
          if (r.ok) { setOpen(false); toast(`${target.sku}: stock adjusted`); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Counted stock" hint={`Currently ${target.stockQuantity} (${target.reservedQuantity} reserved)`}><Input name="newStock" type="number" inputMode="numeric" min={target.reservedQuantity} step={1} required defaultValue={target.stockQuantity} autoFocus /></Field>
            <Field label="Reorder level"><Input name="reorder" type="number" inputMode="numeric" min={0} step={1} defaultValue={target.reorderLevel} /></Field>
          </div>
          <Field label="Reason"><Select name="reason" defaultValue="ADJUSTMENT">
            <option value="ADJUSTMENT">Stock count correction</option><option value="DAMAGED">Damaged</option><option value="LOST">Lost</option><option value="TRANSFER">Transfer</option><option value="MANUAL">Other (manual)</option>
          </Select></Field>
          <Field label="Notes"><Textarea name="notes" rows={2} placeholder="e.g. Cycle count, clasp defect" /></Field>
          <p className="text-xs text-muted">Recorded as a stock movement and in the audit log. Stock can’t go below the units reserved for unpaid orders.</p>
          {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save adjustment"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
