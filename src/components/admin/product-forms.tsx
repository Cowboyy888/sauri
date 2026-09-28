"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Trash2, ExternalLink } from "lucide-react";
import {
  addImageAction, addVariantAction, archiveProductAction, createProductAction, deleteProductAction, duplicateProductAction, removeImageAction, updateProductAction, updateVariantAction,
} from "@/app/admin/actions";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Dialog, DialogContent } from "../ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { useMounted } from "../ui/use-mounted";
import { toast } from "./toast";
import { Thumb } from "./thumb";


type Opt = { id: string; name: string };
const MATERIALS = [["yg", "14K Yellow Gold"], ["wg", "14K White Gold"], ["vm", "18K Gold Vermeil"], ["ss", "Sterling Silver"]] as const;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{e}</p> : null);
const Check = ({ name, label, defaultChecked, disabled }: { name: string; label: string; defaultChecked?: boolean; disabled?: boolean }) => (
  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="size-4 accent-[#2f5d50]" />{label}</label>
);

/* ---------------- create (§25) ---------------- */
export function NewProductForm({ categories, collections }: { categories: Opt[]; collections: Opt[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  const [name, setName] = useState(""), [slug, setSlug] = useState(""), [slugTouched, setSlugTouched] = useState(false);
  const auto = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <form className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]" action={(fd) => start(async () => {
      setErr(null);
      const r = await createProductAction({
        name: s(fd, "name"), slug: slugTouched ? slug : auto, shortDescription: s(fd, "shortDescription"), description: s(fd, "description"), categoryId: s(fd, "categoryId"), collectionId: s(fd, "collectionId"),
        status: s(fd, "status") as "draft", featured: fd.get("featured") === "on", bestSeller: fd.get("bestSeller") === "on", newArrival: fd.get("newArrival") === "on",
        material: s(fd, "material") as "yg", color: s(fd, "color"), size: s(fd, "size"), gemstone: s(fd, "gemstone"), sku: s(fd, "sku"), barcode: s(fd, "barcode"),
        costPrice: s(fd, "costPrice"), sellingPrice: s(fd, "sellingPrice"), compareAtPrice: s(fd, "compareAtPrice"), weightGrams: s(fd, "weight"), reorderLevel: s(fd, "reorderLevel") || "5",
        seoTitle: s(fd, "seoTitle"), seoDescription: s(fd, "seoDescription"), tags: s(fd, "tags"), imageUrls: s(fd, "imageUrls"),
      } as never);
      if (r.ok) { toast("Product created"); router.push(`/admin/products/${(r.data as { id: string }).id}?tab=inventory`); } else setErr(r.error);
    })}>
      <div className="grid grid-cols-1 gap-4">
        <section className="grid grid-cols-1 gap-3.5 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-[14px] font-semibold">Product</h2>
          <Field label="Product name"><Input name="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="URL slug" hint={`/products/${slugTouched ? slug : auto || "…"}`}><Input value={slugTouched ? slug : auto} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} pattern="[a-z0-9-]+" /></Field>
          <Field label="Short description" hint="One line for product cards and search results."><Input name="shortDescription" maxLength={200} /></Field>
          <Field label="Description"><Textarea name="description" rows={5} maxLength={5000} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Category"><Select name="categoryId" required defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</Select></Field>
            <Field label="Collection"><Select name="collectionId" defaultValue=""><option value="">None</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          </div>
        </section>
        <section className="grid grid-cols-1 gap-3.5 rounded-lg border border-line bg-surface p-4">
          <div><h2 className="text-[14px] font-semibold">First variant</h2><p className="text-xs text-muted">Add more sizes, metals or stones on the Variants tab after saving.</p></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Material"><Select name="material" defaultValue="yg">{MATERIALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="SKU" hint="Letters, numbers and dashes"><Input name="sku" required pattern="[A-Za-z0-9-]{3,40}" placeholder="RNG-NEW-YG-6" style={{ textTransform: "uppercase" }} /></Field>
            <Field label="Size"><Input name="size" placeholder="e.g. 6 or 18&quot;" /></Field>
            <Field label="Color"><Input name="color" placeholder="Optional" /></Field>
            <Field label="Gemstone"><Input name="gemstone" placeholder="Optional" /></Field>
            <Field label="Barcode"><Input name="barcode" inputMode="numeric" /></Field>
            <Field label="Cost price (USD)"><Input name="costPrice" type="number" min={0} step="0.01" required inputMode="decimal" /></Field>
            <Field label="Selling price (USD)"><Input name="sellingPrice" type="number" min={0.01} step="0.01" required inputMode="decimal" /></Field>
            <Field label="Compare-at price (USD)" hint="Shown struck through; must exceed the price."><Input name="compareAtPrice" type="number" min={0} step="0.01" inputMode="decimal" /></Field>
            <Field label="Weight (g)"><Input name="weight" type="number" min={0} step="0.1" inputMode="decimal" /></Field>
            <Field label="Reorder level" hint="Low-stock alert at or below this"><Input name="reorderLevel" type="number" min={0} step={1} defaultValue={5} /></Field>
          </div>
          <p className="text-xs text-muted">Stock starts at 0. Receive units with Restock so every unit has a movement record.</p>
        </section>
        <section className="grid grid-cols-1 gap-3.5 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-[14px] font-semibold">Images and SEO</h2>
          <Field label="Image URLs" hint="One per line. https:// (e.g. Supabase Storage) or /products/… The first is the main image."><Textarea name="imageUrls" rows={3} /></Field>
          <Field label="SEO title" hint="Up to 70 characters. Defaults to “Name | SAURI”."><Input name="seoTitle" maxLength={70} /></Field>
          <Field label="SEO description" hint="Up to 160 characters."><Textarea name="seoDescription" rows={2} maxLength={160} /></Field>
          <Field label="Tags" hint="Comma-separated"><Input name="tags" placeholder="gold, everyday, gift" /></Field>
        </section>
      </div>
      <aside className="grid content-start gap-4">
        <section className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-[14px] font-semibold">Status</h2>
          <Select name="status" defaultValue="draft" aria-label="Status"><option value="draft">Draft (hidden from the store)</option><option value="active">Active</option></Select>
          <Check name="featured" label="Featured" /><Check name="bestSeller" label="Best seller" /><Check name="newArrival" label="New arrival" defaultChecked />
        </section>
        <Err e={err} />
        <Button variant="primary" disabled={pending}>{pending ? "Creating…" : "Create product"}</Button>
      </aside>
    </form>
  );
}

/* ---------------- edit: general + SEO (§26) ---------------- */
type P = { id: string; name: string; slug: string; shortDescription: string; description: string; categoryId: string; collectionId: string | null; status: string; featured: boolean; bestSeller: boolean; newArrival: boolean; seoTitle: string | null; seoDescription: string | null; tags: string[] };
export function ProductGeneralForm({ p, categories, collections, readOnly }: { p: P; categories: Opt[]; collections: Opt[]; readOnly: boolean }) {
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]" action={(fd) => start(async () => {
      setErr(null);
      const r = await updateProductAction({ id: p.id, name: s(fd, "name"), slug: s(fd, "slug"), shortDescription: s(fd, "shortDescription"), description: s(fd, "description"), categoryId: s(fd, "categoryId"), collectionId: s(fd, "collectionId"), status: s(fd, "status") as "active", featured: fd.get("featured") === "on", bestSeller: fd.get("bestSeller") === "on", newArrival: fd.get("newArrival") === "on" });
      if (r.ok) toast(r.message ?? "Saved"); else setErr(r.error);
    })}>
      <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3.5 rounded-lg border border-line bg-surface p-4">
        <Field label="Product name"><Input name="name" defaultValue={p.name} required maxLength={120} /></Field>
        <Field label="URL slug" hint="Changing it changes the product’s web address."><Input name="slug" defaultValue={p.slug} pattern="[a-z0-9-]+" /></Field>
        <Field label="Short description"><Input name="shortDescription" defaultValue={p.shortDescription} maxLength={200} /></Field>
        <Field label="Description"><Textarea name="description" rows={6} defaultValue={p.description} maxLength={5000} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Category"><Select name="categoryId" defaultValue={p.categoryId}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Collection"><Select name="collectionId" defaultValue={p.collectionId ?? ""}><option value="">None</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        </div>
      </fieldset>
      <fieldset disabled={readOnly} className="grid content-start gap-3 rounded-lg border border-line bg-surface p-4">
        <p className="text-[13px] font-semibold">Visibility</p>
        <Select name="status" defaultValue={p.status} aria-label="Status"><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></Select>
        <Check name="featured" label="Featured" defaultChecked={p.featured} /><Check name="bestSeller" label="Best seller" defaultChecked={p.bestSeller} /><Check name="newArrival" label="New arrival" defaultChecked={p.newArrival} />
        <Err e={err} />
        {!readOnly && <Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>}
      </fieldset>
    </form>
  );
}

export function ProductSeoForm({ p, readOnly }: { p: P; readOnly: boolean }) {
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  const [title, setTitle] = useState(p.seoTitle ?? ""), [desc, setDesc] = useState(p.seoDescription ?? "");
  return (
    <form className="grid max-w-2xl gap-4" action={(fd) => start(async () => { setErr(null); const r = await updateProductAction({ id: p.id, seoTitle: title, seoDescription: desc, tags: s(fd, "tags") }); if (r.ok) toast("SEO saved"); else setErr(r.error); })}>
      <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3.5 rounded-lg border border-line bg-surface p-4">
        <Field label={`SEO title (${title.length}/70)`}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={70} /></Field>
        <Field label={`SEO description (${desc.length}/160)`}><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={160} /></Field>
        <Field label="Tags" hint="Comma-separated"><Input name="tags" defaultValue={p.tags.join(", ")} /></Field>
        <div className="rounded-md border border-line-soft p-3">
          <p className="text-xs text-muted">Search result preview</p>
          <p className="mt-1 truncate text-[15px] text-[#1a0dab]">{title || `${p.name} | SAURI`}</p>
          <p className="truncate text-xs text-pos">sauri.example/products/{p.slug}</p>
          <p className="line-clamp-2 text-[13px] text-muted">{desc || p.shortDescription}</p>
        </div>
        <Err e={err} />
        {!readOnly && <Button variant="primary" disabled={pending} className="justify-self-start">{pending ? "Saving…" : "Save SEO"}</Button>}
      </fieldset>
    </form>
  );
}

/* ---------------- variants (§29 of Phase 1 brief; price edits are audited) ---------------- */
type V = { id: string; sku: string; label: string; barcode: string | null; status: string; sellingPriceCents: number; costPriceCents: number; compareAtPriceCents: number | null; availableStock: number; image: string | null };
export function VariantRowEditor({ v, readOnly }: { v: V; readOnly: boolean }) {
  const [pending, start] = useTransition(), [dirty, setDirty] = useState(false);
  const margin = (price: number, cost: number) => (price > 0 ? (((price - cost) / price) * 100).toFixed(1) : "0");
  const [price, setPrice] = useState((v.sellingPriceCents / 100).toFixed(2)), [cost, setCost] = useState((v.costPriceCents / 100).toFixed(2));
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2 pl-4 pr-3"><div className="flex items-center gap-2"><Thumb src={v.image} alt="" size={32} /><div className="min-w-0"><p className="truncate font-medium">{v.label}</p><p className="text-xs text-muted">{v.sku}</p></div></div></td>
      <td className="px-2"><Input aria-label={`Price for ${v.sku}`} className="h-8 w-24 text-right" type="number" min={0.01} step="0.01" value={price} disabled={readOnly} onChange={(e) => { setPrice(e.target.value); setDirty(true); }} /></td>
      <td className="px-2"><Input aria-label={`Cost for ${v.sku}`} className="h-8 w-24 text-right" type="number" min={0} step="0.01" value={cost} disabled={readOnly} onChange={(e) => { setCost(e.target.value); setDirty(true); }} /></td>
      <td className="num hidden px-2 text-muted md:table-cell">{margin(Number(price) * 100, Number(cost) * 100)}%</td>
      <td className="num hidden px-2 sm:table-cell">{v.availableStock}</td>
      <td className="hidden px-2 md:table-cell">
        <select aria-label={`Status for ${v.sku}`} defaultValue={v.status} disabled={readOnly || pending} className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
          onChange={(e) => start(async () => { const r = await updateVariantAction({ variantId: v.id, status: e.target.value as "active" }); if (r.ok) toast(`${v.sku} ${e.target.value}`); else toast(r.error, false); })}>
          <option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </td>
      <td className="px-2 pr-4 text-right">{!readOnly && <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty || pending}
        onClick={() => start(async () => { const r = await updateVariantAction({ variantId: v.id, sellingPrice: price, costPrice: cost }); if (r.ok) { setDirty(false); toast(`${v.sku}: prices saved`); } else toast(r.error, false); })}>{pending ? "Saving…" : "Save"}</Button>}</td>
    </tr>
  );
}

export function AddVariantForm({ productId, skuPrefix }: { productId: string; skuPrefix: string }) {
  const [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <Button variant="secondary" onClick={() => setOpen(true)}>Add variant</Button>
      <DialogContent title="Add variant" description="New variants start with 0 stock.">
        <form className="grid grid-cols-1 gap-3" action={(fd) => start(async () => {
          const r = await addVariantAction({ productId, sku: s(fd, "sku"), material: s(fd, "material") as "yg", size: s(fd, "size"), color: s(fd, "color"), gemstone: s(fd, "gemstone"), barcode: s(fd, "barcode"), sellingPrice: s(fd, "price"), costPrice: s(fd, "cost"), compareAtPrice: s(fd, "compare"), reorderLevel: s(fd, "reorder") || "5" } as never);
          if (r.ok) { setOpen(false); toast(r.message ?? "Variant added"); } else setErr(r.error);
        })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Material"><Select name="material">{MATERIALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="SKU"><Input name="sku" required defaultValue={`${skuPrefix}-`} style={{ textTransform: "uppercase" }} /></Field>
            <Field label="Size"><Input name="size" /></Field><Field label="Gemstone"><Input name="gemstone" /></Field>
            <Field label="Color"><Input name="color" /></Field><Field label="Barcode"><Input name="barcode" /></Field>
            <Field label="Selling price (USD)"><Input name="price" type="number" min={0.01} step="0.01" required /></Field>
            <Field label="Cost price (USD)"><Input name="cost" type="number" min={0} step="0.01" required /></Field>
            <Field label="Compare-at (USD)"><Input name="compare" type="number" min={0} step="0.01" /></Field>
            <Field label="Reorder level"><Input name="reorder" type="number" min={0} defaultValue={5} /></Field>
          </div>
          <Err e={err} />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Add variant</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- images ---------------- */
export function ImageManager({ productId, images, readOnly }: { productId: string; images: { id: string; url: string; alt: string }[]; readOnly: boolean }) {
  const [pending, start] = useTransition(), [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {images.map((im, i) => (
          <li key={im.id} className="overflow-hidden rounded-lg border border-line bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.url} alt={im.alt} className="aspect-[4/5] w-full bg-[#f3eee6] object-cover" loading="lazy" />
            <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs">
              <span className="truncate text-muted">{i === 0 ? "Main image" : im.alt || `Image ${i + 1}`}</span>
              {!readOnly && <button className="text-neg hover:underline disabled:opacity-50" disabled={pending} onClick={() => start(async () => { const r = await removeImageAction(im.id); if (r.ok) toast("Image removed"); else toast(r.error, false); })}>Remove</button>}
            </div>
          </li>
        ))}
        {!images.length && <li className="col-span-full rounded-lg border border-dashed border-line p-6 text-center text-[13px] text-muted">No images yet.</li>}
      </ul>
      {!readOnly && (
        <form className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1fr_220px_auto] sm:items-end" action={(fd) => start(async () => {
          setErr(null); const r = await addImageAction(productId, s(fd, "url"), s(fd, "alt")); if (r.ok) toast("Image added"); else setErr(r.error);
        })}>
          <Field label="Image URL" hint="Upload to Supabase Storage and paste the public URL."><Input name="url" required placeholder="https://…" /></Field>
          <Field label="Alt text"><Input name="alt" placeholder="Describe the image" /></Field>
          <Button disabled={pending}>Add image</Button>
          <div className="sm:col-span-3"><Err e={err} /></div>
        </form>
      )}
    </div>
  );
}

/* ---------------- row / header actions: view, duplicate, archive, delete ---------------- */
export function ProductMenu({ id, slug, name, status, canWrite, compact }: { id: string; slug: string; name: string; status: string; canWrite: boolean; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition(), [confirm, setConfirm] = useState(false);
  const mounted = useMounted();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown }>, after?: (d: unknown) => void) => start(async () => { const r = await fn(); if (r.ok) { toast(r.message ?? "Done"); after?.(r.data); } else toast(r.error ?? "Failed", false); });
  if (!mounted) return <Button size={compact ? "iconSm" : "md"} variant={compact ? "ghost" : "secondary"} disabled aria-hidden tabIndex={-1}><MoreHorizontal />{!compact && "More"}</Button>;
  return (
    <>
      <Menu>
        <MenuTrigger asChild><Button size={compact ? "iconSm" : "md"} variant={compact ? "ghost" : "secondary"} aria-label={`Actions for ${name}`} disabled={pending}><MoreHorizontal />{!compact && "More"}</Button></MenuTrigger>
        <MenuContent>
          <MenuItem asChild><a href={`/products/${slug}`} target="_blank" rel="noreferrer"><ExternalLink />View in store</a></MenuItem>
          {canWrite && <>
            <MenuItem onSelect={() => run(() => duplicateProductAction(id), (d) => router.push(`/admin/products/${(d as { id: string }).id}`))}><Copy />Duplicate</MenuItem>
            {status === "archived"
              ? <MenuItem onSelect={() => run(() => archiveProductAction(id, false))}><ArchiveRestore />Restore</MenuItem>
              : <MenuItem onSelect={() => run(() => archiveProductAction(id, true))}><Archive />Archive</MenuItem>}
            <MenuSeparator />
            <MenuItem onSelect={() => setConfirm(true)} className="text-neg [&_svg]:text-neg"><Trash2 />Delete</MenuItem>
          </>}
        </MenuContent>
      </Menu>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title={`Delete ${name}?`} description="Only products that were never stocked or sold can be deleted. Anything with history should be archived, which keeps reports intact.">
          <div className="flex justify-end gap-2"><Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => deleteProductAction(id), () => { setConfirm(false); router.push("/admin/products"); })}>Delete permanently</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
