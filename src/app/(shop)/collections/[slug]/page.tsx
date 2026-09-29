import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getFacets, listProducts, resolveCollection, type SortKey } from "@/lib/storefront/catalog";
import { Breadcrumb } from "@/components/storefront/shop/breadcrumb";
import { ProductCard } from "@/components/storefront/shop/product-card";
import { Pagination } from "@/components/storefront/shop/pagination";
import { CollectionControls, DesktopFilterSidebar } from "@/components/storefront/collections/collection-controls";

export const revalidate = 60;

type SP = Record<string, string | undefined>;
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

async function load(slug: string, sp: SP) {
  const db = getDb();
  const resolved = await resolveCollection(db, slug);
  if (!resolved) return null;
  const [min, max] = (sp.price ?? "").split("-");
  const [result, facets] = await Promise.all([
    listProducts(db, {
      ...resolved.filters,
      material: sp.material?.split(",").filter(Boolean),
      gemstone: sp.gemstone?.split(",").filter(Boolean),
      size: sp.size?.split(",").filter(Boolean),
      priceMinCents: min ? Number(min) * 100 : undefined,
      priceMaxCents: max ? Number(max) * 100 : undefined,
      inStockOnly: sp.availability === "in-stock",
      sort: (sp.sort as SortKey) || "featured",
      page: sp.page ? Number(sp.page) : 1,
    }),
    getFacets(db, resolved.filters),
  ]);
  return { resolved, result, facets };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveCollection(getDb(), slug);
  if (!resolved) return {};
  return { title: resolved.title, description: resolved.description, alternates: { canonical: `/collections/${slug}` } };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const data = await load(slug, sp);
  if (!data) notFound();
  const { resolved, result, facets } = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumb items={[{ label: "Collections", href: "/collections" }, { label: resolved.title }]} />
      <h1 className="mt-4 font-display text-4xl">{resolved.title}</h1>
      <p className="mt-2 max-w-xl font-sans text-sm text-ink/60">{resolved.description}</p>

      <div className="mt-8 flex gap-10">
        <DesktopFilterSidebar facets={facets} />
        <div className="min-w-0 flex-1">
          <CollectionControls facets={facets} total={result.total} />
          {result.items.length === 0 ? (
            <div className="py-24 text-center">
              <p className="font-display text-xl text-ink/70">No pieces match those filters.</p>
              <p className="mt-2 font-sans text-sm text-ink/50">Try removing a filter or exploring another collection.</p>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3">
              {result.items.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
          <Pagination page={result.page} pageCount={result.pageCount} searchParams={sp} />
        </div>
      </div>
    </div>
  );
}
