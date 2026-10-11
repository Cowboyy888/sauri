"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import type { CategorySummary, MaterialOption } from "@/lib/storefront/catalog";

const OCCASIONS = [
  { slug: "everyday", name: "Everyday" },
  { slug: "wedding", name: "Wedding" },
  { slug: "gifts", name: "Gifts" },
  { slug: "statement", name: "Statement" },
];

const MAX_LISTED = 6;
const linkCls = "font-sans text-sm text-ink/80 hover:text-ink";

export function MegaMenu({ categories, materials }: { categories: CategorySummary[]; materials: MaterialOption[] }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };

  return (
    <div onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mega-menu-jewelry"
        onClick={() => setOpen((o) => !o)}
        className="font-sans text-[13px] uppercase tracking-[0.14em] text-ink/80 transition-colors hover:text-ink"
      >
        Jewelry
      </button>
      <div
        id="mega-menu-jewelry"
        hidden={!open}
        className={cn(
          "absolute left-1/2 top-full z-40 mt-5 w-[min(640px,90vw)] -translate-x-1/2 border border-ink/10 bg-warm-white shadow-[0_24px_60px_rgba(35,33,30,.12)]",
        )}
      >
        <div className="grid grid-cols-3 gap-8 p-8">
          <nav aria-label="Shop jewelry">
            <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shop Jewelry</p>
            <ul className="mt-3 space-y-2.5">
              {categories.slice(0, MAX_LISTED).map((c) => (
                <li key={c.slug}><Link href={`/collections/${c.slug}`} className={linkCls}>{c.name}</Link></li>
              ))}
              <li><Link href="/collections" className={cn(linkCls, "text-ink underline-offset-4 hover:underline")}>{categories.length > MAX_LISTED ? `All ${categories.length} categories →` : "All jewelry"}</Link></li>
            </ul>
          </nav>
          <nav aria-label="Shop by material">
            <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shop by Material</p>
            <ul className="mt-3 space-y-2.5">
              {materials.slice(0, MAX_LISTED).map((m) => (
                <li key={m.slug}><Link href={`/collections/all-jewelry?material=${m.slug}`} className={linkCls}>{m.name}</Link></li>
              ))}
              {materials.length > MAX_LISTED && <li><Link href="/collections/all-jewelry" className={cn(linkCls, "text-ink underline-offset-4 hover:underline")}>All materials →</Link></li>}
            </ul>
          </nav>
          <nav aria-label="Shop by occasion">
            <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shop by Occasion</p>
            <ul className="mt-3 space-y-2.5">
              {OCCASIONS.map((o) => (
                <li key={o.slug}><Link href={`/collections/${o.slug}`} className="font-sans text-sm text-ink/80 hover:text-ink">{o.name}</Link></li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
