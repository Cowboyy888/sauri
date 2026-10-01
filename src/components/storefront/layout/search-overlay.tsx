"use client";
import * as D from "@radix-ui/react-dialog";
import Image from "next/image";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CategorySummary, SearchResult } from "@/lib/storefront/catalog";

const RECENT_KEY = "sauri-recent-searches";

function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")); } catch { /* ignore */ } }, []);
  const add = (q: string) => {
    setRecent((prev) => {
      const next = [q, ...prev.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(0, 6);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const clear = () => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } };
  return { recent, add, clear };
}

export function SearchOverlay({ categories }: { categories: CategorySummary[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const { recent, add, clear } = useRecentSearches();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResult(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).then(setResult).catch(() => setResult(null));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <D.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <D.Trigger aria-label="Search" className="p-2"><Search className="size-[18px]" /></D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-ink/35" />
        <D.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className="fixed inset-x-0 top-0 z-50 max-h-[85vh] overflow-y-auto bg-warm-white shadow-[0_20px_50px_rgba(35,33,30,.15)]"
        >
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search the catalog</D.Description>
          <div className="mx-auto max-w-3xl px-6 py-8">
            <div className="flex items-center gap-3 border-b border-ink/15 pb-3">
              <Search className="size-5 shrink-0 text-ink/40" />
              <input
                ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) { add(query.trim()); window.location.href = `/search?q=${encodeURIComponent(query.trim())}`; } }}
                placeholder="Search rings, necklaces, gold…" className="w-full bg-transparent font-display text-2xl placeholder:text-ink/30 focus:outline-none"
              />
              <D.Close aria-label="Close search" className="p-1 text-ink/50 hover:text-ink"><X className="size-5" /></D.Close>
            </div>

            {query.trim().length < 2 ? (
              <div className="mt-8 grid gap-8 sm:grid-cols-2">
                {recent.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Recent searches</p>
                      <button type="button" onClick={clear} className="font-sans text-xs text-ink/40 underline-offset-2 hover:underline">Clear</button>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {recent.map((r) => <li key={r}><button type="button" onClick={() => setQuery(r)} className="font-sans text-sm text-ink/75 hover:text-ink">{r}</button></li>)}
                    </ul>
                  </div>
                )}
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Popular categories</p>
                  <ul className="mt-3 space-y-2">
                    {categories.map((c) => (
                      <li key={c.slug}><Link href={`/collections/${c.slug}`} onClick={() => setOpen(false)} className="font-sans text-sm text-ink/75 hover:text-ink">{c.name}</Link></li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mt-8">
                {result?.categories.length ? (
                  <div className="mb-6 flex flex-wrap gap-2">
                    {result.categories.map((c) => (
                      <Link key={c.slug} href={`/collections/${c.slug}`} onClick={() => setOpen(false)} className="border border-ink/15 px-3 py-1.5 font-sans text-xs uppercase tracking-wide text-ink/70 hover:border-ink">{c.name}</Link>
                    ))}
                  </div>
                ) : null}
                {result?.products.length ? (
                  <ul className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                    {result.products.map((p) => (
                      <li key={p.id}>
                        <Link href={`/products/${p.slug}`} onClick={() => { add(query.trim()); setOpen(false); }} className="group block">
                          <div className="relative aspect-square overflow-hidden bg-beige-soft">
                            {p.image && <Image src={p.image.url} alt={p.image.alt} fill sizes="180px" className="object-cover" />}
                          </div>
                          <p className="mt-2 font-sans text-sm text-ink group-hover:text-ink/70">{p.name}</p>
                          <p className="font-sans text-xs text-ink/50">{formatMoney(p.fromPriceCents)}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-sans text-sm text-ink/50">No results for &ldquo;{query}&rdquo;. Try a category or material.</p>
                )}
              </div>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
