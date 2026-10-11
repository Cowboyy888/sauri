"use client";
import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import type { CategorySummary, MaterialOption } from "@/lib/storefront/catalog";

const OCCASIONS = [
  { slug: "everyday", name: "Everyday" },
  { slug: "wedding", name: "Wedding" },
  { slug: "gifts", name: "Gifts" },
  { slug: "statement", name: "Statement" },
];

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
          "absolute left-1/2 top-full z-40 mt-5 w-[min(880px,90vw)] -translate-x-1/2 border border-ink/10 bg-warm-white shadow-[0_24px_60px_rgba(35,33,30,.12)]",
        )}
      >
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-8 p-8">
          <div className="relative aspect-[4/5] overflow-hidden bg-beige-soft">
            <Image src="/products/aurora-signet-ring-yg-front.svg" alt="A hand wearing layered gold rings" fill sizes="220px" className="object-cover" />
            <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/60 to-transparent p-4 font-sans text-xs uppercase tracking-widest text-warm-white">The Everyday Edit</p>
          </div>
          <nav aria-label="Shop jewelry">
            <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shop Jewelry</p>
            <ul className="mt-3 space-y-2.5">
              {categories.map((c) => (
                <li key={c.slug}><Link href={`/collections/${c.slug}`} className="font-sans text-sm text-ink/80 hover:text-ink">{c.name}</Link></li>
              ))}
              <li><Link href="/collections" className="font-sans text-sm text-ink/80 hover:text-ink">All jewelry</Link></li>
            </ul>
          </nav>
          <nav aria-label="Shop by material">
            <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shop by Material</p>
            <ul className="mt-3 space-y-2.5">
              {materials.map((m) => (
                <li key={m.slug}><Link href={`/collections/all-jewelry?material=${m.slug}`} className="font-sans text-sm text-ink/80 hover:text-ink">{m.name}</Link></li>
              ))}
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
