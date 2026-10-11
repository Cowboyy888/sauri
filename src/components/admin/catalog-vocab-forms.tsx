"use client";
import { useRef, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { createCategoryAction, createMaterialAction, deleteCategoryAction, deleteMaterialAction, setCategoryImageAction } from "@/app/admin/actions";
import { uploadProductImages } from "@/lib/supabase/upload-images";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { toast } from "./toast";

type Row = { id: string; name: string; meta: string; inUse: number; inUseLabel: string; imageUrl?: string | null };

/** Storefront tile photo for one category: uploads straight to storage, then saves the URL on the category. */
function CategoryPhoto({ id, name, url, readOnly }: { id: string; name: string; url: string | null; readOnly: boolean }) {
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const save = (next: string | null) => start(async () => { const r = await setCategoryImageAction(id, next); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); });
  const pick = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      try { const [u] = await uploadProductImages([file], "site/categories"); if (u) { const r = await setCategoryImageAction(id, u); if (r.ok) toast(r.message ?? "Saved"); else toast(r.error, false); } }
      catch (e) { toast(e instanceof Error ? e.message : "Upload failed.", false); }
      finally { if (ref.current) ref.current.value = ""; }
    });
  };
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="size-8 rounded object-cover" /> : <span className="grid size-8 place-items-center rounded border border-dashed border-line text-[10px] text-subtle">none</span>}
      {!readOnly && (
        <>
          <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" aria-label={`Photo for ${name}`} onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => ref.current?.click()}>{pending ? "…" : url ? "Change" : "Photo"}</Button>
          {url && <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(null)}>Clear</Button>}
        </>
      )}
    </span>
  );
}

function Vocab({ title, rows, addLabel, withPrefix, onAdd, onDelete, readOnly, photos }: {
  title: string; rows: Row[]; addLabel: string; withPrefix?: boolean; readOnly: boolean; photos?: boolean;
  onAdd: (name: string, prefix: string) => ReturnType<typeof createCategoryAction>;
  onDelete: (id: string) => ReturnType<typeof deleteCategoryAction>;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="px-4 pb-4">
      <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>
      <ul className={`grid max-h-72 gap-px overflow-y-auto rounded-md border border-line bg-line-soft ${photos ? "" : "sm:grid-cols-2"}`}>
        {rows.length === 0 && <li className="bg-surface px-3 py-2 text-[13px] text-muted sm:col-span-2">None yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 bg-surface px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-muted">{r.meta} · {r.inUse} {r.inUseLabel}</span></span>
            {photos && <CategoryPhoto id={r.id} name={r.name} url={r.imageUrl ?? null} readOnly={readOnly} />}
            {!readOnly && (
              <Button size="sm" variant="danger" disabled={pending} aria-label={`Delete ${r.name}`}
                onClick={() => { if (!confirm(`Delete “${r.name}”?`)) return; start(async () => { const x = await onDelete(r.id); if (x.ok) toast(x.message ?? "Deleted"); else toast(x.error, false); }); }}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form ref={formRef} className="mt-3 flex flex-wrap items-end gap-2" action={(fd) => start(async () => {
          const x = await onAdd(String(fd.get("name") ?? ""), String(fd.get("prefix") ?? ""));
          if (x.ok) { toast(x.message ?? "Added"); formRef.current?.reset(); } else toast(x.error, false);
        })}>
          <label className="grid gap-1 text-xs text-muted">{addLabel}<Input name="name" required maxLength={60} className="w-56" /></label>
          {withPrefix && <label className="grid gap-1 text-xs text-muted">SKU prefix (optional)<Input name="prefix" maxLength={4} placeholder="Auto" className="w-28 uppercase" /></label>}
          <Button type="submit" variant="secondary" disabled={pending}>Add</Button>
        </form>
      )}
    </div>
  );
}

export function CategoriesManager({ rows, readOnly }: { rows: { id: string; name: string; skuPrefix: string; imageUrl: string | null; products: number }[]; readOnly: boolean }) {
  return <Vocab title="Categories" addLabel="New category" withPrefix photos readOnly={readOnly}
    rows={rows.map((r) => ({ id: r.id, name: r.name, meta: `SKU ${r.skuPrefix}`, inUse: r.products, inUseLabel: r.products === 1 ? "product" : "products", imageUrl: r.imageUrl }))}
    onAdd={(name, skuPrefix) => createCategoryAction({ name, skuPrefix })} onDelete={deleteCategoryAction} />;
}

export function MaterialsManager({ rows, readOnly }: { rows: { id: string; name: string; code: string; variants: number }[]; readOnly: boolean }) {
  return <Vocab title="Materials" addLabel="New material" readOnly={readOnly}
    rows={rows.map((r) => ({ id: r.id, name: r.name, meta: r.code, inUse: r.variants, inUseLabel: r.variants === 1 ? "variant" : "variants" }))}
    onAdd={(name) => createMaterialAction({ name })} onDelete={deleteMaterialAction} />;
}
