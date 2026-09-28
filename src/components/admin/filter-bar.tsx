"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../ui/cn";

function useParamSetter() {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    q.delete("page");
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    start(() => router.replace(`${path}${q.size ? `?${q}` : ""}`, { scroll: false }));
  };
  return { sp, set, pending };
}

/** Debounced (300 ms) server-side search: typing updates ?q= and the server returns one page of results. */
export function SearchInput({ placeholder, param = "q", className }: { placeholder: string; param?: string; className?: string }) {
  const { sp, set, pending } = useParamSetter();
  const [v, setV] = useState(sp.get(param) ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { if ((sp.get(param) ?? "") !== v.trim()) set({ [param]: v.trim() || null }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <div className={cn("relative min-w-0 flex-1 sm:max-w-sm", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <input type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className={cn("h-9 w-full rounded-md border border-line bg-surface pl-8 pr-8 text-[13.5px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft", pending && "bg-canvas")} />
      {v && <button type="button" onClick={() => setV("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-fg" aria-label="Clear search"><X className="size-3.5" /></button>}
    </div>
  );
}

export function FilterSelect({ param, label, options, allLabel = "All" }: { param: string; label: string; options: { value: string; label: string }[]; allLabel?: string }) {
  const { sp, set } = useParamSetter();
  return (
    <label className="flex items-center gap-1.5 text-[13px]">
      <span className="sr-only">{label}</span>
      <select value={sp.get(param) ?? ""} onChange={(e) => set({ [param]: e.target.value || null })} aria-label={label}
        className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg focus:border-accent focus:outline-none">
        <option value="">{`${label}: ${allLabel}`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">{children}</div>;
}

/** Link-style tabs driven by a query param, e.g. ?tab=variants. */
export function TabLinks({ tabs, param = "tab", current }: { tabs: { value: string; label: string; count?: number }[]; param?: string; current: string }) {
  const path = usePathname(), sp = useSearchParams();
  return (
    <nav aria-label="Sections" className="-mb-px flex gap-1 relative overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const q = new URLSearchParams(sp.toString()); q.delete("page");
        if (t.value === tabs[0]!.value) q.delete(param); else q.set(param, t.value);
        const active = current === t.value;
        return (
          <a key={t.value} href={`${path}${q.size ? `?${q}` : ""}`} aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted hover:text-fg", active && "border-fg text-fg")}>
            {t.label}{t.count != null && <span className="ml-1.5 rounded bg-line-soft px-1.5 text-xs text-muted">{t.count}</span>}
          </a>
        );
      })}
    </nav>
  );
}
