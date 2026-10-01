"use client";
import { useState, useTransition } from "react";
import {
  saveSupplierAction, setSupplierStatusAction, saveSupplierProductAction, removeSupplierProductAction,
  createPurchaseOrderAction, updatePurchaseOrderAction, setPurchaseOrderStatusAction,
  addPurchaseDocumentAction, removePurchaseDocumentAction, sendPurchaseOrderEmailAction, recordPurchasePaymentAction,
  receivePurchaseOrderAction, startStocktakeAction, recordCountAction, completeStocktakeAction, cancelStocktakeAction,
  setStocktakeSettingsAction, setTargetStockLevelAction, setStoreSettingsAction,
} from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { toast } from "./toast";
import { money } from "@/lib/format";
import type { SupplierRow } from "@/lib/purchasing/suppliers";
import type { PurchaseOrderRow } from "@/lib/purchasing/orders";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);

/* ------------------------------------------------------------------ suppliers */
export function SupplierFormButton({ mode, supplier, label }: { mode: "create" | "edit"; supplier?: SupplierRow; label: string }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant={mode === "create" ? "primary" : "secondary"} size={mode === "create" ? "md" : "sm"} onClick={() => setOpen(true)}>{label}</Button>
      <DialogContent title={mode === "create" ? "New supplier" : "Edit supplier"}>
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await saveSupplierAction({
            id: supplier?.id, name: s(fd, "name"), company: s(fd, "company"), contactPerson: s(fd, "contactPerson"), email: s(fd, "email"), phone: s(fd, "phone"),
            addressLine1: s(fd, "addressLine1"), city: s(fd, "city"), postalCode: s(fd, "postalCode"), country: s(fd, "country"), website: s(fd, "website"),
            paymentTerms: s(fd, "paymentTerms"), currency: s(fd, "currency"), leadTimeDays: s(fd, "leadTimeDays"), minimumOrder: s(fd, "minimumOrder"), notes: s(fd, "notes"),
          } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier name"><Input name="name" required defaultValue={supplier?.name} /></Field>
            <Field label="Company"><Input name="company" defaultValue={supplier?.company ?? ""} /></Field>
            <Field label="Contact person"><Input name="contactPerson" defaultValue={supplier?.contactPerson ?? ""} /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={supplier?.email ?? ""} /></Field>
            <Field label="Phone"><Input name="phone" defaultValue={supplier?.phone ?? ""} /></Field>
            <Field label="Website"><Input name="website" defaultValue={supplier?.website ?? ""} /></Field>
            <Field label="Address"><Input name="addressLine1" defaultValue={supplier?.addressLine1 ?? ""} /></Field>
            <Field label="City"><Input name="city" defaultValue={supplier?.city ?? ""} /></Field>
            <Field label="Postal code"><Input name="postalCode" defaultValue={supplier?.postalCode ?? ""} /></Field>
            <Field label="Country"><Input name="country" defaultValue={supplier?.country ?? ""} /></Field>
            <Field label="Payment terms"><Input name="paymentTerms" placeholder="Net 30" defaultValue={supplier?.paymentTerms ?? ""} /></Field>
            <Field label="Currency"><Input name="currency" defaultValue={supplier?.currency ?? "USD"} /></Field>
            <Field label="Lead time (days)"><Input name="leadTimeDays" type="number" min={0} defaultValue={supplier?.leadTimeDays ?? undefined} /></Field>
            <Field label="Minimum order (USD)"><Input name="minimumOrder" type="number" min={0} step="0.01" defaultValue={supplier?.minimumOrderCents != null ? supplier.minimumOrderCents / 100 : undefined} /></Field>
          </div>
          <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={supplier?.notes ?? ""} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{mode === "create" ? "Create" : "Save"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NEXT_SUPPLIER_STATUS: Record<string, string[]> = { ACTIVE: ["INACTIVE", "BLOCKED"], INACTIVE: ["ACTIVE", "BLOCKED"], BLOCKED: ["ACTIVE"] };
export function SupplierStatusControl({ id, status }: { id: string; status: "ACTIVE" | "INACTIVE" | "BLOCKED" }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {NEXT_SUPPLIER_STATUS[status]!.map((next) => (
        <Button key={next} size="sm" disabled={pending} onClick={() => start(async () => { const r = await setSupplierStatusAction(id, next); if (r.ok) toast(r.message ?? "Updated"); else toast(r.error, false); })}>
          {next.charAt(0) + next.slice(1).toLowerCase()}
        </Button>
      ))}
    </div>
  );
}

export type VariantOption = { id: string; sku: string; name: string };
export function SupplierProductFormButton({ supplierId, variants }: { supplierId: string; variants: VariantOption[] }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Add product</Button>
      <DialogContent title="Add supplied product">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await saveSupplierProductAction({ supplierId, variantId: s(fd, "variantId"), supplierSku: s(fd, "supplierSku"), purchasePrice: s(fd, "purchasePrice"), currency: s(fd, "currency"), minimumOrderQuantity: s(fd, "moq"), leadTimeDays: s(fd, "leadTimeDays"), preferredSupplier: fd.get("preferred") === "on" } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); } else setErr(r.error);
        })}>
          <Field label="Product / variant"><Select name="variantId" required><option value="">Choose</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.sku}</option>)}</Select></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier SKU"><Input name="supplierSku" /></Field>
            <Field label="Purchase price (USD)"><Input name="purchasePrice" type="number" min={0} step="0.01" required /></Field>
            <Field label="Currency"><Input name="currency" defaultValue="USD" /></Field>
            <Field label="Minimum order qty"><Input name="moq" type="number" min={1} /></Field>
            <Field label="Lead time (days)"><Input name="leadTimeDays" type="number" min={0} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="preferred" /> Preferred supplier for this product</label>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
/** The inverse of SupplierProductFormButton — used from a product's own page: the variant is fixed, the
 *  supplier is chosen from a dropdown (brief §12: "a product can have multiple suppliers"). */
export function AddProductSupplierButton({ variantId, variantLabel, suppliers }: { variantId: string; variantLabel: string; suppliers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Add supplier for {variantLabel}</Button>
      <DialogContent title={`Add a supplier for ${variantLabel}`}>
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await saveSupplierProductAction({ supplierId: s(fd, "supplierId"), variantId, supplierSku: s(fd, "supplierSku"), purchasePrice: s(fd, "purchasePrice"), currency: s(fd, "currency"), minimumOrderQuantity: s(fd, "moq"), leadTimeDays: s(fd, "leadTimeDays"), preferredSupplier: fd.get("preferred") === "on" } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); } else setErr(r.error);
        })}>
          <Field label="Supplier"><Select name="supplierId" required><option value="">Choose</option>{suppliers.map((s2) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}</Select></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier SKU"><Input name="supplierSku" /></Field>
            <Field label="Purchase price (USD)"><Input name="purchasePrice" type="number" min={0} step="0.01" required /></Field>
            <Field label="Currency"><Input name="currency" defaultValue="USD" /></Field>
            <Field label="Minimum order qty"><Input name="moq" type="number" min={1} /></Field>
            <Field label="Lead time (days)"><Input name="leadTimeDays" type="number" min={0} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="preferred" /> Preferred supplier for this variant</label>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function RemoveSupplierProductButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await removeSupplierProductAction(id); if (r.ok) toast(r.message ?? "Removed"); else toast(r.error, false); })}>Remove</Button>;
}

/* ------------------------------------------------------------------ purchase orders */
export type POVariantOption = { id: string; sku: string; name: string; costPriceCents: number };
type POLine = { variantId: string; supplierSku: string; quantity: number; unitCost: number; discount: number };

export function PurchaseOrderForm({ mode, po, suppliers, variants, initialItems }: {
  mode: "create" | "edit"; po?: PurchaseOrderRow; suppliers: { id: string; name: string }[]; variants: POVariantOption[];
  initialItems?: (POLine & { id?: string })[];
}) {
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? "");
  const [lines, setLines] = useState<POLine[]>(initialItems?.length ? initialItems : [{ variantId: "", supplierSku: "", quantity: 1, unitCost: 0, discount: 0 }]);
  const addLine = () => setLines((l) => [...l, { variantId: "", supplierSku: "", quantity: 1, unitCost: 0, discount: 0 }]);
  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<POLine>) => setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitCost * 100 - l.discount * 100, 0);

  return (
    <form className="grid grid-cols-1 gap-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const items = lines.filter((l) => l.variantId).map((l) => ({ variantId: l.variantId, supplierSku: l.supplierSku || undefined, quantity: l.quantity, unitCost: l.unitCost, discount: l.discount || undefined }));
      const input = { supplierId, expectedDeliveryDate: s(fd, "expectedDeliveryDate"), currency: s(fd, "currency"), paymentTerms: s(fd, "paymentTerms"), notes: s(fd, "notes"), discount: s(fd, "discount"), shipping: s(fd, "shipping"), tax: s(fd, "tax"), dueDate: s(fd, "dueDate"), items };
      start(async () => {
        const r = mode === "create" ? await createPurchaseOrderAction(input as never) : await updatePurchaseOrderAction(po!.id, input as never);
        if (r.ok) { toast(r.message ?? "Saved"); if (mode === "create" && r.data && typeof r.data === "object" && "id" in r.data) window.location.href = `/admin/purchases/${(r.data as { id: string }).id}`; }
        else setErr(r.error);
      });
    }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required><option value="">Choose</option>{suppliers.map((s2) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}</Select></Field>
        <Field label="Expected delivery"><Input name="expectedDeliveryDate" type="date" defaultValue={po?.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toISOString().slice(0, 10) : undefined} /></Field>
        <Field label="Currency"><Input name="currency" defaultValue={po?.currency ?? "USD"} /></Field>
        <Field label="Payment terms"><Input name="paymentTerms" defaultValue={po?.paymentTerms ?? ""} /></Field>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead><tr className="border-b border-line bg-canvas text-xs text-muted"><th className="px-2 py-2 text-left">Product</th><th className="px-2 py-2 text-left">Supplier SKU</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Unit cost</th><th className="px-2 py-2 text-right">Discount</th><th className="px-2 py-2 text-right">Line total</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-line-soft">
                <td className="px-2 py-1.5"><Select value={l.variantId} onChange={(e) => { const v = variants.find((x) => x.id === e.target.value); updateLine(i, { variantId: e.target.value, unitCost: v ? v.costPriceCents / 100 : l.unitCost }); }}><option value="">Choose</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.sku}</option>)}</Select></td>
                <td className="px-2 py-1.5"><Input value={l.supplierSku} onChange={(e) => updateLine(i, { supplierSku: e.target.value })} /></td>
                <td className="px-2 py-1.5"><Input type="number" min={1} className="text-right" value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 1 })} /></td>
                <td className="px-2 py-1.5"><Input type="number" min={0} step="0.01" className="text-right" value={l.unitCost} onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) || 0 })} /></td>
                <td className="px-2 py-1.5"><Input type="number" min={0} step="0.01" className="text-right" value={l.discount} onChange={(e) => updateLine(i, { discount: Number(e.target.value) || 0 })} /></td>
                <td className="px-2 py-1.5 text-right font-medium">{money(Math.round(l.quantity * l.unitCost * 100 - l.discount * 100))}</td>
                <td className="px-2 py-1.5 text-right">{lines.length > 1 && <Button type="button" size="sm" onClick={() => removeLine(i)}>Remove</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" size="sm" onClick={addLine}>Add line</Button>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Discount (USD)"><Input name="discount" type="number" min={0} step="0.01" defaultValue={po ? po.discountCents / 100 : undefined} /></Field>
        <Field label="Shipping (USD)"><Input name="shipping" type="number" min={0} step="0.01" defaultValue={po ? po.shippingCents / 100 : undefined} /></Field>
        <Field label="Tax (USD)"><Input name="tax" type="number" min={0} step="0.01" defaultValue={po ? po.taxCents / 100 : undefined} /></Field>
      </div>
      <p className="text-right text-[14px] font-semibold">Subtotal: {money(subtotal)}</p>
      <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={po?.notes ?? ""} /></Field>
      <Err e={err} />
      <div className="flex justify-end"><Button variant="primary" disabled={pending}>{mode === "create" ? "Create draft" : "Save changes"}</Button></div>
    </form>
  );
}

const NEXT_PO_STATUS: Record<string, string[]> = { DRAFT: ["PENDING_APPROVAL", "CANCELLED"], PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"], APPROVED: ["ORDERED", "CANCELLED"], ORDERED: ["CANCELLED"], PARTIALLY_RECEIVED: ["CANCELLED"], RECEIVED: [], CANCELLED: [] };
export function PurchaseOrderStatusControl({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const options = NEXT_PO_STATUS[status] ?? [];
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((next) => (
        <Button key={next} size="sm" variant={next === "APPROVED" ? "primary" : "secondary"} disabled={pending}
          onClick={() => start(async () => { const r = await setPurchaseOrderStatusAction(id, next); if (r.ok) toast(r.message ?? "Updated"); else toast(r.error, false); })}>
          {next === "PENDING_APPROVAL" ? "Submit for approval" : next.charAt(0) + next.slice(1).toLowerCase().replace("_", " ")}
        </Button>
      ))}
    </div>
  );
}

export function PurchaseOrderDocumentForm({ purchaseOrderId }: { purchaseOrderId: string }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Add document</Button>
      <DialogContent title="Add document" description="A quotation, invoice, packing list, or receiving document — by URL (e.g. Supabase Storage).">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await addPurchaseDocumentAction({ purchaseOrderId, filename: s(fd, "filename"), url: s(fd, "url"), type: s(fd, "type") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Added"); } else setErr(r.error);
        })}>
          <Field label="File name"><Input name="filename" required /></Field>
          <Field label="URL (https://)"><Input name="url" required placeholder="https://" /></Field>
          <Field label="Type"><Select name="type" defaultValue="other"><option value="quotation">Quotation</option><option value="invoice">Invoice</option><option value="packing_list">Packing list</option><option value="receiving_document">Receiving document</option><option value="other">Other</option></Select></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Add</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function RemovePurchaseDocumentButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await removePurchaseDocumentAction(id); if (r.ok) toast(r.message ?? "Removed"); else toast(r.error, false); })}>Remove</Button>;
}

export function SendPurchaseOrderEmailForm({ purchaseOrderId, defaultEmail }: { purchaseOrderId: string; defaultEmail?: string | null }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Email supplier</Button>
      <DialogContent title="Send purchase order" description="Never sent automatically — this is an explicit send.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await sendPurchaseOrderEmailAction(purchaseOrderId, s(fd, "email"));
          if (r.ok) { setOpen(false); toast(r.message ?? "Sent"); } else setErr(r.error);
        })}>
          <Field label="Recipient email"><Input name="email" type="email" required defaultValue={defaultEmail ?? ""} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Send</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecordPaymentForm({ purchaseOrderId }: { purchaseOrderId: string }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button size="sm" onClick={() => setOpen(true)}>Record payment</Button>
      <DialogContent title="Record a payment">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await recordPurchasePaymentAction({ purchaseOrderId, amount: s(fd, "amount"), paidAt: s(fd, "paidAt"), note: s(fd, "note") } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Recorded"); } else setErr(r.error);
        })}>
          <Field label="Amount (USD)"><Input name="amount" type="number" min={0.01} step="0.01" required /></Field>
          <Field label="Date"><Input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
          <Field label="Note"><Input name="note" maxLength={300} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Record</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ receiving */
export type ReceivingItem = { purchaseOrderItemId: string; sku: string; productName: string; quantity: number; receivedQuantity: number; unitCostCents: number };
export function ReceivingForm({ purchaseOrderId, items }: { purchaseOrderId: string; items: ReceivingItem[] }) {
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  const [rows, setRows] = useState(items.map(() => ({ accepted: 0, damaged: 0, rejected: 0 })));
  const update = (i: number, patch: Partial<{ accepted: number; damaged: number; rejected: number }>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const receiveAll = () => setRows(items.map((i) => ({ accepted: i.quantity - i.receivedQuantity, damaged: 0, rejected: 0 })));

  return (
    <form className="grid grid-cols-1 gap-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const lines = items.map((it, i) => ({ purchaseOrderItemId: it.purchaseOrderItemId, acceptedQuantity: rows[i]!.accepted, damagedQuantity: rows[i]!.damaged, rejectedQuantity: rows[i]!.rejected })).filter((l) => l.acceptedQuantity + l.damagedQuantity + l.rejectedQuantity > 0);
      if (!lines.length) { setErr("Enter a received quantity for at least one line."); return; }
      start(async () => {
        const r = await receivePurchaseOrderAction({ purchaseOrderId, notes: s(fd, "notes"), lines } as never);
        if (r.ok) { toast(r.message ?? "Received"); window.location.reload(); } else setErr(r.error);
      });
    }}>
      <div className="flex justify-end"><Button type="button" size="sm" onClick={receiveAll}>Receive all (remaining, no damage)</Button></div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead><tr className="border-b border-line bg-canvas text-xs text-muted"><th className="px-2 py-2 text-left">SKU</th><th className="px-2 py-2 text-left">Product</th><th className="px-2 py-2 text-right">Ordered</th><th className="px-2 py-2 text-right">Previously received</th><th className="px-2 py-2 text-right">Remaining</th><th className="px-2 py-2 text-right">Accepted</th><th className="px-2 py-2 text-right">Damaged</th><th className="px-2 py-2 text-right">Rejected</th></tr></thead>
          <tbody>
            {items.map((it, i) => {
              const remaining = it.quantity - it.receivedQuantity;
              return (
                <tr key={it.purchaseOrderItemId} className="border-b border-line-soft">
                  <td className="px-2 py-1.5 font-mono text-xs">{it.sku}</td>
                  <td className="px-2 py-1.5">{it.productName}</td>
                  <td className="px-2 py-1.5 text-right">{it.quantity}</td>
                  <td className="px-2 py-1.5 text-right">{it.receivedQuantity}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{remaining}</td>
                  <td className="px-2 py-1.5"><Input type="number" min={0} max={remaining} className="text-right" value={rows[i]!.accepted} onChange={(e) => update(i, { accepted: Math.min(remaining, Number(e.target.value) || 0) })} /></td>
                  <td className="px-2 py-1.5"><Input type="number" min={0} max={remaining} className="text-right" value={rows[i]!.damaged} onChange={(e) => update(i, { damaged: Number(e.target.value) || 0 })} /></td>
                  <td className="px-2 py-1.5"><Input type="number" min={0} max={remaining} className="text-right" value={rows[i]!.rejected} onChange={(e) => update(i, { rejected: Number(e.target.value) || 0 })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
      <p className="text-xs text-muted">Only accepted units become sellable stock. Damaged and rejected units are recorded but never added to inventory.</p>
      <Err e={err} />
      <div className="flex justify-end"><Button variant="primary" disabled={pending}>Confirm receipt</Button></div>
    </form>
  );
}

/* ------------------------------------------------------------------ stocktake */
export function StartStocktakeButton({ locations }: { locations: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant="primary" onClick={() => setOpen(true)}>Start stocktake</Button>
      <DialogContent title="Start a stocktake" description="Snapshots every active variant's current stock as the expected quantity.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await startStocktakeAction({ locationId: s(fd, "locationId"), notes: s(fd, "notes") });
          if (r.ok && r.data) window.location.href = `/admin/inventory/stocktake/${(r.data as { id: string }).id}`; else setErr(r.ok ? "Something went wrong." : r.error);
        })}>
          <Field label="Location (optional)"><Select name="locationId"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Start</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StocktakeCountInput({ stocktakeId, variantId, defaultValue }: { stocktakeId: string; variantId: string; defaultValue: number | null }) {
  const [pending, start] = useTransition();
  return (
    <Input type="number" min={0} className="w-24 text-right" defaultValue={defaultValue ?? undefined} disabled={pending}
      onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0) start(async () => { const r = await recordCountAction(stocktakeId, variantId, v); if (!r.ok) toast(r.error, false); }); }} />
  );
}
export function CompleteStocktakeButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await completeStocktakeAction(id); if (r.ok) { toast(r.message ?? "Completed"); window.location.reload(); } else toast(r.error, false); })}>Apply adjustments</Button>;
}
export function CancelStocktakeButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button disabled={pending} onClick={() => start(async () => { const r = await cancelStocktakeAction(id); if (r.ok) { toast(r.message ?? "Cancelled"); window.location.reload(); } else toast(r.error, false); })}>Cancel</Button>;
}
export function StocktakeSettingsForm({ approvalThresholdUnits }: { approvalThresholdUnits: number }) {
  const [pending, start] = useTransition();
  return (
    <form className="flex items-end gap-3" action={(fd) => start(async () => { const r = await setStocktakeSettingsAction({ approvalThresholdUnits: s(fd, "threshold") } as never); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); })}>
      <Field label="Approval threshold (units)" hint="A single-line discrepancy at or above this needs OWNER/ADMIN approval"><Input name="threshold" type="number" min={0} defaultValue={approvalThresholdUnits} /></Field>
      <Button type="submit" disabled={pending}>Save</Button>
    </form>
  );
}

/* ------------------------------------------------------------------ inventory target level */
export function TargetStockLevelButton({ variantId, current }: { variantId: string; current: number | null }) {
  const [open, setOpen] = useState(false), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>Target: {current ?? "—"}</Button>
      <DialogContent title="Target stock level">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const raw = s(fd, "level"); const r = await setTargetStockLevelAction(variantId, raw === "" ? null : Number(raw));
          if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); } else toast(r.error, false);
        })}>
          <Field label="Target stock level" hint="Leave empty to use the default estimate"><Input name="level" type="number" min={0} defaultValue={current ?? undefined} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ store settings */
export function CompanyDetailsForm({ companyName, companyAddress, companyEmail, companyPhone }: { companyName: string; companyAddress: string; companyEmail: string; companyPhone: string }) {
  const [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" action={(fd) => start(async () => {
      const r = await setStoreSettingsAction({ companyName: s(fd, "companyName"), companyAddress: s(fd, "companyAddress"), companyEmail: s(fd, "companyEmail"), companyPhone: s(fd, "companyPhone") });
      if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false);
    })}>
      <Field label="Company name"><Input name="companyName" defaultValue={companyName} /></Field>
      <Field label="Company email"><Input name="companyEmail" type="email" defaultValue={companyEmail} /></Field>
      <Field label="Company address"><Input name="companyAddress" defaultValue={companyAddress} /></Field>
      <Field label="Company phone"><Input name="companyPhone" defaultValue={companyPhone} /></Field>
      <div><Button type="submit" variant="primary" disabled={pending}>Save company details</Button></div>
    </form>
  );
}
