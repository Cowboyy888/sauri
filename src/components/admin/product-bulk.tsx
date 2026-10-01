"use client";
import { useRef, useState, useTransition } from "react";
import {
  bulkSetProductStatusAction, bulkSetCategoryAction, bulkSetCollectionAction, bulkSetReorderLevelAction,
  validateProductImportAction, applyProductImportAction,
} from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Input, Select } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { Card, CardBody, CardHeader } from "../ui/card";
import { toast } from "./toast";
import type { ImportPreview } from "@/lib/catalog/import";

type Row = { id: string; name: string; sku: string; status: string };

/** Bulk archive/activate/category/collection/reorder-level (brief §6) — a compact checklist over the
 *  products already loaded for the page (never a second query), collapsed by default so it doesn't compete
 *  with the main table. Bulk price changes are deliberately not offered here at all (brief: "do not allow
 *  dangerous bulk price changes without confirmation" — the safest version of that rule is not building the
 *  feature this phase). */
export function ProductBulkPanel({ products, categories, collections }: { products: Row[]; categories: { id: string; name: string }[]; collections: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const toggle = (id: string) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const ids = [...selected];

  const run = (label: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    if (!ids.length) { toast("Select at least one product first.", false); return; }
    if (!confirm(`${label} for ${ids.length} product(s)?`)) return;
    start(async () => { const r = await fn(); if (r.ok) toast(r.message ?? "Updated"); else toast(r.error ?? "Failed", false); });
  };

  return (
    <Card>
      <CardHeader title="Bulk actions" description="Select products, then apply one change to all of them." actions={<Button size="sm" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</Button>} />
      {open && (
        <CardBody className="grid grid-cols-1 gap-3">
          <div className="max-h-64 overflow-y-auto rounded-md border border-line">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 border-b border-line-soft px-3 py-1.5 text-[13px] last:border-0">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{p.sku}</span><span className="text-xs text-muted">{p.status}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">{ids.length} selected</span>
            <Button size="sm" disabled={pending} onClick={() => run("Archive", () => bulkSetProductStatusAction(ids, "archived"))}>Archive</Button>
            <Button size="sm" disabled={pending} onClick={() => run("Activate", () => bulkSetProductStatusAction(ids, "active"))}>Activate</Button>
            <Select className="h-8 w-auto" disabled={pending} defaultValue="" onChange={(e) => { if (e.target.value) run("Update category", () => bulkSetCategoryAction(ids, e.target.value)); e.target.value = ""; }}>
              <option value="" disabled>Set category…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select className="h-8 w-auto" disabled={pending} defaultValue="" onChange={(e) => { run("Update collection", () => bulkSetCollectionAction(ids, e.target.value)); e.target.value = ""; }}>
              <option value="" disabled>Set collection…</option><option value="">None</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); const level = Number(new FormData(e.currentTarget).get("level")); if (Number.isInteger(level) && level >= 0) run("Set reorder level", () => bulkSetReorderLevelAction(ids, level)); }}>
              <Input name="level" type="number" min={0} className="h-8 w-20" placeholder="Level" />
              <Button type="submit" size="sm" disabled={pending}>Set reorder level</Button>
            </form>
          </div>
        </CardBody>
      )}
    </Card>
  );
}

/** CSV import (brief §7): upload → validate → preview → show errors → confirm → apply, one transaction. */
export function ProductImportButton() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    const text = await file.text();
    start(async () => {
      const r = await validateProductImportAction(text);
      if (r.ok) setPreview(r.data ?? null); else toast(r.error, false);
    });
  };
  const apply = () => {
    if (!preview) return;
    start(async () => {
      const r = await applyProductImportAction(preview);
      if (r.ok) { toast(r.message ?? "Imported"); setOpen(false); setPreview(null); window.location.reload(); } else toast(r.error, false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreview(null); }}>
      <Button onClick={() => setOpen(true)}>Import CSV</Button>
      <DialogContent title="Import products" description="Columns: Product Name, SKU, Category, Collection, Variant, Cost, Price, Stock, Reorder Level (optional: Material, Color, Size, Gemstone, Barcode).">
        <div className="grid grid-cols-1 gap-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          {preview && (
            <>
              <p className="text-[13px]">{preview.rows.length} row(s) parsed{preview.errors.length ? `, ${preview.errors.length} error(s)` : ""}.</p>
              {preview.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md bg-[#f8e9e6] p-2 text-[12.5px] text-neg">
                  {preview.errors.slice(0, 50).map((e, i) => <p key={i}>Line {e.line}: {e.field} — {e.message}</p>)}
                </div>
              )}
              {preview.errors.length === 0 && (
                <div className="max-h-56 overflow-y-auto rounded-md border border-line text-[12.5px]">
                  <table className="w-full"><thead><tr className="border-b border-line bg-canvas"><th className="px-2 py-1 text-left">Product</th><th className="px-2 py-1 text-left">SKU</th><th className="px-2 py-1 text-left">Category</th><th className="px-2 py-1 text-right">Cost</th><th className="px-2 py-1 text-right">Price</th><th className="px-2 py-1 text-right">Stock</th></tr></thead>
                    <tbody>{preview.rows.slice(0, 100).map((r) => <tr key={r.line} className="border-b border-line-soft"><td className="px-2 py-1">{r.productName}</td><td className="px-2 py-1">{r.sku}</td><td className="px-2 py-1">{r.category}</td><td className="px-2 py-1 text-right">{(r.costCents / 100).toFixed(2)}</td><td className="px-2 py-1 text-right">{(r.priceCents / 100).toFixed(2)}</td><td className="px-2 py-1 text-right">{r.stock}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending || !preview || preview.errors.length > 0 || !preview.rows.length} onClick={apply}>Confirm import</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
