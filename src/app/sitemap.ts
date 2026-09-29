import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db/client";
import { getCategories, getCollections, listProducts } from "@/lib/storefront/catalog";

const STATIC_PAGES = ["", "/collections", "/pages/about", "/pages/contact", "/pages/shipping", "/pages/returns", "/pages/care"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const db = getDb();
  const [categories, collections, products] = await Promise.all([
    getCategories(db), getCollections(db), listProducts(db, { perPage: 48 }),
  ]);

  return [
    ...STATIC_PAGES.map((path) => ({ url: `${base}${path}`, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.6 })),
    ...categories.map((c) => ({ url: `${base}/collections/${c.slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...collections.map((c) => ({ url: `${base}/collections/${c.slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...products.items.map((p) => ({ url: `${base}/products/${p.slug}`, changeFrequency: "daily" as const, priority: 0.7 })),
  ];
}
