import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCategories, searchProducts } from "@/lib/storefront/catalog";
import { ProductCard } from "@/components/storefront/shop/product-card";
import Link from "next/link";

export const metadata: Metadata = { title: "Search", robots: { index: false } };
type Props = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const db = getDb();
  const [result, categories] = await Promise.all([searchProducts(db, q, 24), getCategories(db)]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl">{q ? <>Results for &ldquo;{q}&rdquo;</> : "Search"}</h1>

      {q.trim().length < 2 ? (
        <div className="mt-8">
          <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Popular categories</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link key={c.slug} href={`/collections/${c.slug}`} className="border border-ink/15 px-4 py-2 font-sans text-xs uppercase tracking-wide text-ink/70 hover:border-ink">{c.name}</Link>
            ))}
          </div>
        </div>
      ) : result.products.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-display text-xl text-ink/70">No results for &ldquo;{q}&rdquo;.</p>
          <p className="mt-2 font-sans text-sm text-ink/50">Try a broader term, a material, or browse a category below.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {categories.map((c) => (
              <Link key={c.slug} href={`/collections/${c.slug}`} className="border border-ink/15 px-4 py-2 font-sans text-xs uppercase tracking-wide text-ink/70 hover:border-ink">{c.name}</Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          {result.categories.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {result.categories.map((c) => (
                <Link key={c.slug} href={`/collections/${c.slug}`} className="border border-ink/15 px-3 py-1.5 font-sans text-xs uppercase tracking-wide text-ink/70 hover:border-ink">{c.name}</Link>
              ))}
            </div>
          )}
          <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {result.products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
