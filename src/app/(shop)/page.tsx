import Image from "next/image";
import Link from "next/link";
import { Package, RotateCcw, ShieldCheck, Sparkles, Truck } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { getBestSellers, getCategories, getNewArrivals } from "@/lib/storefront/catalog";
import { ProductRail } from "@/components/storefront/shop/product-rail";
import { BRAND } from "@/lib/storefront/brand";

export const revalidate = 60;

const CATEGORY_IMAGE: Record<string, string> = {
  rings: "/products/aurora-signet-ring-yg-front.svg",
  earrings: "/products/astra-diamond-studs-yg-front.svg",
  necklaces: "/products/soleil-chain-necklace-yg-front.svg",
  bracelets: "/products/celeste-tennis-bracelet-yg-front.svg",
};

const EDITORIAL = [
  { title: "Our Story", copy: "Why we make jewelry the way we do.", href: "/pages/about" },
  { title: "The Art of Everyday Jewelry", copy: "Pieces designed to survive a shower, a keyboard and a decade.", href: "/collections/everyday" },
  { title: "Jewelry Care", copy: "How to keep solid gold and pearls looking new.", href: "/pages/care" },
  { title: "Gift Guide", copy: "Considered pieces for the people who matter.", href: "/collections/gifts" },
];

const TRUST = [
  { icon: Truck, title: "Complimentary Shipping", copy: "On every order over $150." },
  { icon: RotateCcw, title: "Easy Returns", copy: "30 days, no questions asked." },
  { icon: ShieldCheck, title: "Secure Checkout", copy: "Your information stays yours." },
  { icon: Sparkles, title: "Authentic Materials", copy: "Solid gold, never plated." },
  { icon: Package, title: "Customer Support", copy: "Real people, real answers." },
];

export default async function HomePage() {
  const db = getDb();
  const [categories, bestSellers, newArrivals] = await Promise.all([getCategories(db), getBestSellers(db, 8), getNewArrivals(db, 8)]);

  return (
    <>
      <section className="relative flex h-[calc(100svh-88px)] min-h-[520px] items-end overflow-hidden bg-charcoal">
        <Image src="/products/celeste-tennis-bracelet-yg-front.svg" alt="A hand wearing a solid gold tennis bracelet" fill priority sizes="100vw" className="shop-drift object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
        <div className="relative mx-auto w-full max-w-7xl px-6 pb-16 text-warm-white sm:pb-20">
          <p className="shop-reveal font-sans text-xs uppercase tracking-[0.3em] text-warm-white/70">{BRAND.name}</p>
          <h1 className="shop-reveal shop-delay-1 mt-4 max-w-2xl font-display text-4xl leading-[1.08] sm:text-6xl">Jewelry for every moment</h1>
          <p className="shop-reveal shop-delay-2 mt-5 max-w-md font-sans text-[15px] text-warm-white/85">Thoughtfully designed pieces made to become part of your everyday story.</p>
          <div className="shop-reveal shop-delay-3 mt-8 flex flex-wrap gap-3">
            <Link href="/collections/new-arrivals" className="shop-press bg-warm-white px-6 py-3 font-sans text-xs uppercase tracking-[0.14em] text-ink hover:bg-warm-white/90">Shop New Arrivals</Link>
            <Link href="/collections/best-sellers" className="shop-press border border-warm-white/70 px-6 py-3 font-sans text-xs uppercase tracking-[0.14em] text-warm-white hover:border-warm-white">Explore Best Sellers</Link>
          </div>
        </div>
      </section>

      <section className="shop-scroll-in mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {categories.map((c) => (
            <Link key={c.slug} href={`/collections/${c.slug}`} className="group relative aspect-[3/4] overflow-hidden bg-beige-soft">
              {CATEGORY_IMAGE[c.slug] && <Image src={CATEGORY_IMAGE[c.slug]!} alt={c.name} fill sizes="(min-width:1024px) 25vw, 50vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />}
              <div className="absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <p className="font-display text-xl text-warm-white">{c.name}</p>
                <p className="mt-1 font-sans text-xs uppercase tracking-widest text-warm-white/80 transition-transform duration-300 group-hover:translate-x-1">Shop Now →</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <ProductRail title="Best Sellers" viewAllHref="/collections/best-sellers" products={bestSellers} />
      <ProductRail title="New Arrivals" viewAllHref="/collections/new-arrivals" products={newArrivals} />

      <section className="bg-ivory">
        <div className="shop-scroll-in mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-3xl">From the studio</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {EDITORIAL.map((e) => (
              <Link key={e.title} href={e.href} className="group border-t border-ink/15 pt-5">
                <p className="font-display text-lg text-ink">{e.title}</p>
                <p className="mt-2 font-sans text-sm text-ink/60">{e.copy}</p>
                <p className="mt-3 font-sans text-xs uppercase tracking-widest text-ink/50 transition-all duration-300 group-hover:translate-x-1 group-hover:text-ink">Read more →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="shop-scroll-in mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
          {TRUST.map((t) => (
            <div key={t.title} className="group text-center">
              <t.icon className="mx-auto size-6 text-ink/60 transition-transform duration-300 group-hover:-translate-y-1" strokeWidth={1.3} />
              <p className="mt-3 font-sans text-xs uppercase tracking-wide text-ink">{t.title}</p>
              <p className="mt-1 font-sans text-xs text-ink/50">{t.copy}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
