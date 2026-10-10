"use client";
import Link from "next/link";
import { Heart, ShoppingBag, User } from "lucide-react";
import { MegaMenu } from "./mega-menu";
import { MobileNav } from "./mobile-nav";
import { SearchOverlay } from "./search-overlay";
import { useCart } from "@/components/storefront/cart/cart-provider";
import { BRAND } from "@/lib/storefront/brand";
import type { CategorySummary } from "@/lib/storefront/catalog";

const CATEGORY_LABELS: Record<string, string> = { rings: "Rings", earrings: "Earrings", necklaces: "Necklaces", bracelets: "Bracelets" };

export function Header({ categories }: { categories: CategorySummary[] }) {
  const { count, open } = useCart();
  const ordered = [...categories].sort((a, b) => (CATEGORY_LABELS[a.slug] ?? a.name).localeCompare(CATEGORY_LABELS[b.slug] ?? b.name));

  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-warm-white/95 backdrop-blur">
      <div className="bg-ink py-2 text-center font-sans text-[11px] uppercase tracking-[0.14em] text-warm-white">
        {BRAND.announce}
      </div>
      <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-1 lg:hidden">
          <MobileNav categories={categories} />
        </div>
        <nav className="relative hidden items-center gap-7 lg:flex" aria-label="Primary">
          <Link href="/collections/new-arrivals" className="font-sans text-[13px] uppercase tracking-[0.14em] text-ink/80 hover:text-ink">New</Link>
          <MegaMenu categories={ordered} />
          {ordered.map((c) => (
            <Link key={c.slug} href={`/collections/${c.slug}`} className="font-sans text-[13px] uppercase tracking-[0.14em] text-ink/80 hover:text-ink">{CATEGORY_LABELS[c.slug] ?? c.name}</Link>
          ))}
          <Link href="/collections/gifts" className="font-sans text-[13px] uppercase tracking-[0.14em] text-ink/80 hover:text-ink">Gifts</Link>
        </nav>

        <Link href="/" className="absolute left-1/2 -translate-x-1/2 font-display text-xl tracking-[0.08em] text-ink lg:static lg:translate-x-0">
          {BRAND.name}
        </Link>

        <div className="flex items-center gap-1">
          <SearchOverlay categories={categories} />
          <Link href="/account" aria-label="Account" className="hidden p-2 lg:inline-flex"><User className="size-[18px]" /></Link>
          <Link href="/wishlist" aria-label="Wishlist" className="hidden p-2 lg:inline-flex"><Heart className="size-[18px]" /></Link>
          <button type="button" onClick={open} aria-label={`Bag, ${count} item${count === 1 ? "" : "s"}`} className="relative p-2">
            <ShoppingBag className="size-[18px]" />
            {count > 0 && (
              <span key={count} className="shop-bump absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-ink font-sans text-[9px] text-warm-white">{count}</span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
