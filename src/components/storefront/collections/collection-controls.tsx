"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetCloseButton } from "@/components/storefront/layout/sheet";
import { FilterPanel, type FilterState } from "./filter-panel";
import type { Facets, SortKey } from "@/lib/storefront/catalog";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "best-selling", label: "Best Selling" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "rating", label: "Customer Rating" },
];

function parseState(params: URLSearchParams): FilterState {
  const list = (k: string) => (params.get(k)?.split(",").filter(Boolean) ?? []);
  const [min, max] = (params.get("price") ?? "").split("-");
  return { material: list("material"), gemstone: list("gemstone"), size: list("size"), priceMin: min ? Number(min) * 100 : null, priceMax: max ? Number(max) * 100 : null, inStockOnly: params.get("availability") === "in-stock" };
}

/** Reads the collection's filter/sort state from the URL and returns a setter that pushes a new,
 *  shareable URL — the same state the server component re-renders the grid from. */
function useCollectionQuery(facets: Facets) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = parseState(searchParams);
  const sort = (searchParams.get("sort") as SortKey) || "featured";

  function apply(next: FilterState, nextSort: SortKey = sort) {
    const params = new URLSearchParams(searchParams);
    const set = (key: string, value: string) => (value ? params.set(key, value) : params.delete(key));
    set("material", next.material.join(","));
    set("gemstone", next.gemstone.join(","));
    set("size", next.size.join(","));
    set("price", next.priceMin != null || next.priceMax != null ? `${(next.priceMin ?? facets.priceMinCents) / 100}-${(next.priceMax ?? facets.priceMaxCents) / 100}` : "");
    set("availability", next.inStockOnly ? "in-stock" : "");
    set("sort", nextSort === "featured" ? "" : nextSort);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return { state, sort, apply };
}

export function CollectionControls({ facets, total }: { facets: Facets; total: number }) {
  const { state, sort, apply } = useCollectionQuery(facets);
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeCount = state.material.length + state.gemstone.length + state.size.length + (state.inStockOnly ? 1 : 0) + (state.priceMax != null ? 1 : 0);

  return (
    <>
      <div className="flex items-center justify-between border-b border-ink/10 pb-4">
        <p className="font-sans text-sm text-ink/60">{total} {total === 1 ? "piece" : "pieces"}</p>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setMobileOpen(true)} className="flex items-center gap-1.5 font-sans text-xs uppercase tracking-widest text-ink/70 lg:hidden">
            <SlidersHorizontal className="size-3.5" /> Filter{activeCount > 0 && ` (${activeCount})`}
          </button>
          <label className="flex items-center gap-2 font-sans text-xs uppercase tracking-widest text-ink/70">
            Sort
            <select value={sort} onChange={(e) => apply(state, e.target.value as SortKey)} className="border-none bg-transparent font-sans text-xs uppercase tracking-widest text-ink focus:outline-none">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent title="Filter" side="left" className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Filter</h2>
            <SheetCloseButton />
          </div>
          <div className="mt-6 flex-1 overflow-y-auto">
            <FilterPanel facets={facets} value={state} onChange={(next) => apply(next)} />
          </div>
          <button type="button" onClick={() => setMobileOpen(false)} className="mt-6 w-full bg-ink py-3.5 font-sans text-xs uppercase tracking-widest text-warm-white">Show {total} results</button>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function DesktopFilterSidebar({ facets }: { facets: Facets }) {
  const { state, apply } = useCollectionQuery(facets);
  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Filter</p>
      <div className="mt-4"><FilterPanel facets={facets} value={state} onChange={(next) => apply(next)} /></div>
    </aside>
  );
}
