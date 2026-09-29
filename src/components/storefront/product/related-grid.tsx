import { ProductCard } from "@/components/storefront/shop/product-card";
import type { ProductCard as ProductCardData } from "@/lib/storefront/catalog";

export function RelatedGrid({ title, products }: { title: string; products: ProductCardData[] }) {
  if (!products.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}
