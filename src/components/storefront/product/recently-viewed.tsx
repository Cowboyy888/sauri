"use client";
import { useEffect, useState } from "react";
import { ProductCard } from "@/components/storefront/shop/product-card";
import type { ProductCard as ProductCardData } from "@/lib/storefront/catalog";

const KEY = "sauri-recently-viewed";

export function trackRecentlyViewed(productId: string) {
  try {
    const ids: string[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    localStorage.setItem(KEY, JSON.stringify([productId, ...ids.filter((id) => id !== productId)].slice(0, 12)));
  } catch { /* private mode: skip tracking */ }
}

/** Renders the shopper's recently viewed products (anonymous: localStorage; signed-in customers get the
 *  same view today — a per-account history is a natural Phase 4 addition once orders drive personalization). */
export function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const [products, setProducts] = useState<ProductCardData[] | null>(null);

  useEffect(() => {
    let ids: string[] = [];
    try { ids = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { /* ignore */ }
    ids = ids.filter((id) => id !== excludeId);
    if (!ids.length) { setProducts([]); return; }
    fetch(`/api/products/summaries?ids=${ids.join(",")}`).then((r) => r.json()).then(setProducts).catch(() => setProducts([]));
  }, [excludeId]);

  if (!products?.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <h2 className="font-display text-2xl">Recently Viewed</h2>
      <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}
