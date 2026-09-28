"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Thumb } from "./thumb";
import { cn } from "../ui/cn";

type Hit = { kind: string; id: string; title: string; subtitle: string; href: string; image?: string | null };

/** Top-bar search across orders, products, SKUs/barcodes and customers (only what your role may see). Debounced, server-side. */
export function GlobalSearch({ scopes }: { scopes: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState(""), [hits, setHits] = useState<Hit[]>([]), [open, setOpen] = useState(false), [active, setActive] = useState(0), [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : { hits: [] })).then((d) => { setHits(d.hits ?? []); setActive(0); setOpen(true); }).catch(() => {}).finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const go = (h: Hit) => { setOpen(false); setQ(""); router.push(h.href); };
  const label = `Search ${scopes.join(", ")}`;
  return (
    <div ref={box} className="relative min-w-0 flex-1 md:max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} placeholder={label} aria-label={label}
        role="combobox" aria-expanded={open} aria-controls="global-search-results" aria-autocomplete="list"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]!); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-[13.5px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft" />
      {open && q.trim().length >= 2 && (
        <ul id="global-search-results" role="listbox" className="absolute left-0 right-0 top-11 z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-[0_16px_40px_rgba(0,0,0,.12)] md:w-[min(520px,90vw)]">
          {hits.length ? hits.map((h, i) => (
            <li key={`${h.kind}-${h.id}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left", i === active && "bg-line-soft")}>
                {h.kind === "product" ? <Thumb src={h.image} alt="" size={30} /> : <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded bg-canvas text-[10px] font-semibold uppercase text-muted">{h.kind.slice(0, 3)}</span>}
                <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{h.title}</span><span className="block truncate text-xs text-muted">{h.subtitle}</span></span>
              </button>
            </li>
          )) : <li className="px-3 py-4 text-[13px] text-muted">{loading ? "Searching…" : `No matches for “${q.trim()}”.`}</li>}
        </ul>
      )}
    </div>
  );
}
