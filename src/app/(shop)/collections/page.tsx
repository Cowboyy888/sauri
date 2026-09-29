import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCategories, getCollections } from "@/lib/storefront/catalog";
import { Breadcrumb } from "@/components/storefront/shop/breadcrumb";

export const revalidate = 60;
export const metadata: Metadata = { title: "Collections", description: "Shop the full studio collection by category or by edit." };

const CATEGORY_IMAGE: Record<string, string> = {
  rings: "/products/aurora-signet-ring-yg-front.svg",
  earrings: "/products/astra-diamond-studs-yg-front.svg",
  necklaces: "/products/soleil-chain-necklace-yg-front.svg",
  bracelets: "/products/celeste-tennis-bracelet-yg-front.svg",
};

export default async function CollectionsIndex() {
  const db = getDb();
  const [categories, collections] = await Promise.all([getCategories(db), getCollections(db)]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumb items={[{ label: "Collections" }]} />
      <h1 className="mt-4 font-display text-4xl">Collections</h1>

      <p className="mt-8 font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shop by category</p>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {categories.map((c) => (
          <Link key={c.slug} href={`/collections/${c.slug}`} className="group relative aspect-square overflow-hidden bg-beige-soft">
            {CATEGORY_IMAGE[c.slug] && <Image src={CATEGORY_IMAGE[c.slug]!} alt={c.name} fill sizes="(min-width:1024px) 25vw, 50vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/55 to-transparent p-4">
              <p className="font-display text-lg text-warm-white">{c.name}</p>
              <p className="font-sans text-xs text-warm-white/75">{c.count} {c.count === 1 ? "piece" : "pieces"}</p>
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-14 font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shop by edit</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {collections.map((c) => (
          <Link key={c.slug} href={`/collections/${c.slug}`} className="border border-ink/10 p-6 hover:border-ink/30">
            <p className="font-display text-xl">{c.name}</p>
            <p className="mt-1 font-sans text-sm text-ink/60">{c.description}</p>
            <p className="mt-2 font-sans text-xs uppercase tracking-widest text-ink/45">{c.count} {c.count === 1 ? "piece" : "pieces"}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
