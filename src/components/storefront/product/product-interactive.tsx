"use client";
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { ImageGallery } from "./image-gallery";
import { Price } from "@/components/storefront/shop/price";
import { StockLabel } from "@/components/storefront/shop/badge";
import { WishlistButton } from "@/components/storefront/shop/wishlist-button";
import { NotifyBackInStock } from "./notify-back-in-stock";
import { useCart } from "@/components/storefront/cart/cart-provider";
import { materialName } from "@/lib/format";
import { STORE } from "@/lib/config";
import type { ProductDetail } from "@/lib/storefront/catalog";

const MATERIAL_SWATCH: Record<string, string> = { yg: "#D6B36C", wg: "#D3D4D6", vm: "#E3B769", ss: "#C3C5C8" };
const MATERIAL_ORDER = ["yg", "wg", "vm", "ss"];

export function ProductInteractive({ product }: { product: ProductDetail }) {
  const { variants } = product;
  const [selectedId, setSelectedId] = useState(variants[0]!.id);
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const { addLine } = useCart();

  const current = variants.find((v) => v.id === selectedId) ?? variants[0]!;
  const materials = [...new Set(variants.map((v) => v.material))].sort((a, b) => (MATERIAL_ORDER.indexOf(a) + 1 || 99) - (MATERIAL_ORDER.indexOf(b) + 1 || 99));
  const sizes = variants.some((v) => v.size) ? [...new Set(variants.map((v) => v.size).filter((s): s is string => !!s))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)) : [];
  const gemstones = variants.some((v) => v.gemstone) ? [...new Set(variants.map((v) => v.gemstone).filter((g): g is string => !!g))] : [];

  function pick(dim: "material" | "size" | "gemstone", value: string) {
    const wanted = { material: current.material, size: current.size, gemstone: current.gemstone, [dim]: value };
    const exact = variants.find((v) => v.material === wanted.material && v.size === wanted.size && v.gemstone === wanted.gemstone);
    const fallback = variants.find((v) => v[dim] === value);
    setSelectedId((exact ?? fallback ?? current).id);
    setQuantity(1);
    setJustAdded(false);
  }

  const maxQty = Math.min(STORE.maxQuantityPerLine, current.available);
  const soldOut = current.stockStatus === "OUT_OF_STOCK";

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
      <ImageGallery images={product.images} activeMaterial={current.material} productName={product.name} />

      <div className="max-w-lg">
        {product.badge && <p className="font-sans text-xs uppercase tracking-[0.16em] text-champagne">{product.badge}</p>}
        <h1 className="mt-2 font-display text-3xl">{product.name}</h1>
        {product.reviewCount > 0 && (
          <p className="mt-2 font-sans text-sm text-ink/60">★ {product.avgRating?.toFixed(1)} · {product.reviewCount} review{product.reviewCount === 1 ? "" : "s"}</p>
        )}
        <Price cents={current.priceCents} compareAtCents={current.compareAtPriceCents} className="mt-4 font-display text-2xl text-ink" />
        <p className="mt-4 font-sans text-sm leading-relaxed text-ink/70">{product.shortDescription}</p>

        <fieldset className="mt-7">
          <legend className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Material — {materialName(current.material)}</legend>
          <div className="mt-3 flex gap-2.5">
            {materials.map((m) => (
              <button
                key={m} type="button" aria-label={materialName(m)} aria-pressed={current.material === m}
                onClick={() => pick("material", m)}
                className={`size-9 rounded-full border-2 ${current.material === m ? "border-ink" : "border-transparent"}`}
                style={{ boxShadow: `inset 0 0 0 2px var(--color-warm-white), inset 0 0 0 4px ${MATERIAL_SWATCH[m] ?? "#ccc"}` }}
              />
            ))}
          </div>
        </fieldset>

        {sizes.length > 0 && (
          <fieldset className="mt-6">
            <legend className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Size</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {sizes.map((s) => {
                const enabled = variants.some((v) => v.material === current.material && v.size === s && v.available > 0);
                return (
                  <button key={s} type="button" disabled={!enabled} onClick={() => pick("size", s)} aria-pressed={current.size === s}
                    className={`size-10 border font-sans text-sm disabled:cursor-not-allowed disabled:text-ink/25 disabled:line-through ${current.size === s ? "border-ink bg-ink text-warm-white" : "border-ink/20 text-ink/70 hover:border-ink/50"}`}>
                    {s}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {gemstones.length > 0 && (
          <fieldset className="mt-6">
            <legend className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Gemstone</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {gemstones.map((g) => (
                <button key={g} type="button" onClick={() => pick("gemstone", g)} aria-pressed={current.gemstone === g}
                  className={`border px-3.5 py-2 font-sans text-sm capitalize ${current.gemstone === g ? "border-ink bg-ink text-warm-white" : "border-ink/20 text-ink/70 hover:border-ink/50"}`}>
                  {g}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-6"><StockLabel status={current.stockStatus} available={current.available} /></div>

        <div className="mt-6 flex items-center gap-4">
          <div className="flex items-center border border-ink/20">
            <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="p-3 disabled:opacity-30"><Minus className="size-4" /></button>
            <span className="w-10 text-center font-sans text-sm tabular-nums">{quantity}</span>
            <button type="button" aria-label="Increase quantity" disabled={quantity >= maxQty} onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} className="p-3 disabled:opacity-30"><Plus className="size-4" /></button>
          </div>
          <button
            type="button" disabled={soldOut}
            onClick={() => { addLine(current.id, quantity); setJustAdded(true); }}
            className="flex-1 bg-ink py-3.5 font-sans text-xs uppercase tracking-[0.14em] text-warm-white transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:bg-ink/25"
          >
            {soldOut ? "Sold out" : justAdded ? "Added to bag ✓" : "Add to Bag"}
          </button>
          <WishlistButton productId={product.id} />
        </div>
        {soldOut && <NotifyBackInStock variantId={current.id} />}

        {product.details.length > 0 && (
          <ul className="mt-8 space-y-2 border-t border-ink/10 pt-6 font-sans text-sm text-ink/65">
            {product.details.map((d) => <li key={d}>· {d}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
