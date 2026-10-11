"use client";
import { useRef, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { createCategoryAction, createMaterialAction, deleteCategoryAction, deleteMaterialAction } from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { toast } from "./toast";

type Row = { id: string; name: string; meta: string; inUse: number; inUseLabel: string };

function Vocab({ title, rows, addLabel, withPrefix, onAdd, onDelete, readOnly }: {
  title: string; rows: Row[]; addLabel: string; withPrefix?: boolean; readOnly: boolean;
  onAdd: (name: string, prefix: string) => ReturnType<typeof createCategoryAction>;
  onDelete: (id: string) => ReturnType<typeof deleteCategoryAction>;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="px-4 pb-4">
      <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>
      <ul className="divide-y divide-line-soft rounded-md border border-line">
        {rows.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">None yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
            <span className="min-w-0"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted">{r.meta} · {r.inUse} {r.inUseLabel}</span></span>
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

export function CategoriesManager({ rows, readOnly }: { rows: { id: string; name: string; skuPrefix: string; products: number }[]; readOnly: boolean }) {
  return <Vocab title="Categories" addLabel="New category" withPrefix readOnly={readOnly}
    rows={rows.map((r) => ({ id: r.id, name: r.name, meta: `SKU ${r.skuPrefix}`, inUse: r.products, inUseLabel: r.products === 1 ? "product" : "products" }))}
    onAdd={(name, skuPrefix) => createCategoryAction({ name, skuPrefix })} onDelete={deleteCategoryAction} />;
}

export function MaterialsManager({ rows, readOnly }: { rows: { id: string; name: string; code: string; variants: number }[]; readOnly: boolean }) {
  return <Vocab title="Materials" addLabel="New material" readOnly={readOnly}
    rows={rows.map((r) => ({ id: r.id, name: r.name, meta: r.code, inUse: r.variants, inUseLabel: r.variants === 1 ? "variant" : "variants" }))}
    onAdd={(name) => createMaterialAction({ name })} onDelete={deleteMaterialAction} />;
}
