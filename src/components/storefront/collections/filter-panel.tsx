"use client";
import { formatMoney } from "@/lib/money";
import { MATERIAL_NAME } from "@/lib/format";
import type { Facets } from "@/lib/storefront/catalog";

export type FilterState = { material: string[]; gemstone: string[]; size: string[]; priceMin: number | null; priceMax: number | null; inStockOnly: boolean };

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterPanel({ facets, value, onChange }: { facets: Facets; value: FilterState; onChange: (next: FilterState) => void }) {
  return (
    <div className="flex flex-col gap-8">
      {facets.materials.length > 1 && (
        <fieldset>
          <legend className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Material</legend>
          <div className="mt-3 flex flex-col gap-2.5">
            {facets.materials.map((m) => (
              <label key={m} className="flex items-center gap-2.5 font-sans text-sm text-ink/80">
                <input type="checkbox" checked={value.material.includes(m)} onChange={() => onChange({ ...value, material: toggle(value.material, m) })} className="size-4 accent-ink" />
                {MATERIAL_NAME[m] ?? m}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {facets.gemstones.length > 0 && (
        <fieldset>
          <legend className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Gemstone</legend>
          <div className="mt-3 flex flex-col gap-2.5">
            {facets.gemstones.map((g) => (
              <label key={g} className="flex items-center gap-2.5 font-sans text-sm capitalize text-ink/80">
                <input type="checkbox" checked={value.gemstone.includes(g)} onChange={() => onChange({ ...value, gemstone: toggle(value.gemstone, g) })} className="size-4 accent-ink" />
                {g}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {facets.sizes.length > 0 && (
        <fieldset>
          <legend className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Size</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {facets.sizes.map((s) => (
              <button
                key={s} type="button" onClick={() => onChange({ ...value, size: toggle(value.size, s) })}
                aria-pressed={value.size.includes(s)}
                className={`size-9 border font-sans text-sm ${value.size.includes(s) ? "border-ink bg-ink text-warm-white" : "border-ink/20 text-ink/70 hover:border-ink/50"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {facets.priceMaxCents > facets.priceMinCents && (
        <fieldset>
          <legend className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Price</legend>
          <div className="mt-3 flex items-center gap-3 font-sans text-sm text-ink/70">
            <span>{formatMoney(value.priceMin ?? facets.priceMinCents)}</span>
            <span>–</span>
            <span>{formatMoney(value.priceMax ?? facets.priceMaxCents)}</span>
          </div>
          <input
            type="range" min={facets.priceMinCents} max={facets.priceMaxCents} step={100}
            value={value.priceMax ?? facets.priceMaxCents}
            onChange={(e) => onChange({ ...value, priceMax: Number(e.target.value) })}
            className="mt-2 w-full accent-ink"
          />
        </fieldset>
      )}
      <label className="flex items-center gap-2.5 font-sans text-sm text-ink/80">
        <input type="checkbox" checked={value.inStockOnly} onChange={() => onChange({ ...value, inStockOnly: !value.inStockOnly })} className="size-4 accent-ink" />
        In stock only
      </label>
    </div>
  );
}
