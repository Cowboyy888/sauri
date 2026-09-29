"use client";
import Link from "next/link";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetCloseButton, SheetTrigger } from "./sheet";
import type { CategorySummary } from "@/lib/storefront/catalog";
import { BRAND } from "@/lib/storefront/brand";

const PRIMARY = [
  { href: "/collections/new-arrivals", label: "New" },
  { href: "/collections/gifts", label: "Gifts" },
];

export function MobileNav({ categories }: { categories: CategorySummary[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger aria-label="Open menu" className="p-2 lg:hidden">
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent title={`${BRAND.name} menu`} side="left" className="p-6">
        <div className="flex items-center justify-between">
          <span className="font-display text-lg tracking-wide">{BRAND.name}</span>
          <SheetCloseButton />
        </div>
        <nav className="mt-8 flex flex-col" aria-label="Mobile">
          {PRIMARY.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="border-b border-ink/10 py-4 font-display text-xl text-ink">{l.label}</Link>
          ))}
          {categories.map((c) => (
            <Link key={c.slug} href={`/collections/${c.slug}`} onClick={() => setOpen(false)} className="border-b border-ink/10 py-4 font-display text-xl text-ink">{c.name}</Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 pt-8 font-sans text-sm text-ink/70">
          <Link href="/account" onClick={() => setOpen(false)}>Account</Link>
          <Link href="/wishlist" onClick={() => setOpen(false)}>Wishlist</Link>
          <Link href="/pages/contact" onClick={() => setOpen(false)}>Contact</Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
