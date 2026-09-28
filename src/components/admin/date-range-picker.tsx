"use client";
import * as Popover from "@radix-ui/react-popover";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { RANGE_OPTIONS } from "@/lib/admin/range";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { cn } from "../ui/cn";

/** Presets + custom range. The choice lives in the URL (?range=30d or ?from=…&to=…) so any view can be shared. */
export function DateRangePicker({ className }: { className?: string }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const [pending, start] = useTransition();
  const from = sp.get("from"), to = sp.get("to");
  const current = from && to ? "custom" : sp.get("range") ?? "30d";
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from ?? ""), [t, setT] = useState(to ?? "");
  const today = new Date().toISOString().slice(0, 10);

  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const k of ["range", "from", "to", "page"]) q.delete(k);
    for (const [k, v] of Object.entries(patch)) if (v) q.set(k, v);
    start(() => router.push(`${path}?${q}`, { scroll: false }));
  };

  return (
    <div className={cn("flex items-center gap-2", pending && "opacity-70", className)}>
      <label className="sr-only" htmlFor="range-select">Date range</label>
      <select id="range-select" className="h-9 rounded-md border border-line bg-surface px-2 text-[13px] md:hidden" value={current}
        onChange={(e) => (e.target.value === "custom" ? setOpen(true) : go({ range: e.target.value }))}>
        {RANGE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      <div role="group" aria-label="Date range" className="hidden h-9 items-center rounded-md border border-line bg-surface p-0.5 md:inline-flex">
        {RANGE_OPTIONS.map((o) => (
          <button key={o.key} type="button" aria-pressed={current === o.key} title={o.label} onClick={() => go({ range: o.key })}
            className={cn("h-full rounded px-2.5 text-[12.5px] font-medium text-muted hover:text-fg", current === o.key && "bg-fg text-white hover:text-white")}>{o.short}</button>
        ))}
      </div>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant={current === "custom" ? "primary" : "secondary"} size="md" aria-label="Custom date range">
            <CalendarDays />{current === "custom" ? `${from} → ${to}` : <span className="hidden lg:inline">Custom</span>}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} className="admin z-50 w-72 rounded-lg border border-line bg-surface p-4 shadow-[0_12px_32px_rgba(0,0,0,.12)]">
            <form className="grid grid-cols-1 gap-3" onSubmit={(e) => { e.preventDefault(); if (f && t && f <= t) { setOpen(false); go({ from: f, to: t }); } }}>
              <p className="text-[13px] font-semibold">Custom range</p>
              <label className="grid grid-cols-1 gap-1 text-xs text-muted">From<Input type="date" value={f} max={t || today} onChange={(e) => setF(e.target.value)} required /></label>
              <label className="grid grid-cols-1 gap-1 text-xs text-muted">To<Input type="date" value={t} min={f} max={today} onChange={(e) => setT(e.target.value)} required /></label>
              {f && t && f > t && <p className="text-xs text-neg">The start date must be before the end date.</p>}
              <p className="text-xs text-subtle">Days are counted in the store’s time zone. Compared with the same number of days immediately before.</p>
              <Button variant="primary" type="submit" disabled={!f || !t || f > t}>Apply</Button>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
