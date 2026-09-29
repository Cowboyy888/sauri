import Link from "next/link";
import { Newsletter } from "./newsletter";
import { BRAND } from "@/lib/storefront/brand";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: "Shop", links: [
    { href: "/collections/new-arrivals", label: "New Arrivals" },
    { href: "/collections/best-sellers", label: "Best Sellers" },
    { href: "/collections/rings", label: "Rings" },
    { href: "/collections/earrings", label: "Earrings" },
    { href: "/collections/necklaces", label: "Necklaces" },
    { href: "/collections/bracelets", label: "Bracelets" },
    { href: "/collections/gifts", label: "Gifts" },
  ] },
  { title: "About", links: [
    { href: "/pages/about", label: "Our Story" },
    { href: "/pages/care", label: "Materials & Care" },
    { href: "/pages/about#craftsmanship", label: "Craftsmanship" },
  ] },
  { title: "Help", links: [
    { href: "/pages/contact", label: "Contact" },
    { href: "/pages/shipping", label: "Shipping" },
    { href: "/pages/returns", label: "Returns" },
    { href: "/pages/care", label: "Care Guide" },
  ] },
  { title: "Legal", links: [
    { href: "/pages/legal/privacy", label: "Privacy" },
    { href: "/pages/legal/terms", label: "Terms" },
    { href: "/pages/legal/cookies", label: "Cookie Policy" },
  ] },
];

export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-ivory">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <Newsletter />
        <div className="mt-14 grid grid-cols-2 gap-8 sm:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}><Link href={l.href} className="font-sans text-sm text-ink/70 hover:text-ink">{l.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-ink/10 pt-6 sm:flex-row sm:items-center">
          <Link href="/" className="font-display text-lg">{BRAND.name}</Link>
          <p className="font-sans text-xs text-ink/45">© {new Date().getFullYear()} {BRAND.name}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
