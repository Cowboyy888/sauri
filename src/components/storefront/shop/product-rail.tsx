import Link from "next/link";
import { ProductCard } from "./product-card";
import type { ProductCard as ProductCardData } from "@/lib/storefront/catalog";

export function ProductRail({ title, viewAllHref, products }: { title: string; viewAllHref: string; products: ProductCardData[] }) {
  if (!products.length) return null;
  return (
    <section className="shop-scroll-in mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-3xl text-ink">{title}</h2>
        <Link href={viewAllHref} className="shop-link-line pb-0.5 font-sans text-xs uppercase tracking-[0.14em] text-ink/60 hover:text-ink">Shop all →</Link>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}
