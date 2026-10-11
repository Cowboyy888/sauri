/**
 * Read-only storefront catalog queries. Every listing is a live aggregate over products / product_variants /
 * inventory — nothing here is hardcoded, and nothing loads the whole catalog into the browser (listProducts
 * paginates). See docs/DATABASE_SCHEMA.md for the tables and docs/ANALYTICS.md for the "best selling" figure,
 * which is computed here from real order_items, not from the curated `best_seller` flag.
 */
import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { categories, collections, inventory, materials, productImages, productVariants, products, reviews } from "../db/schema";
import { availableStock, stockStatus, type StockStatus } from "../inventory/service";

export type ImageRef = { url: string; alt: string };

/* ------------------------------------------------------------------ cards */
export type ProductCard = {
  id: string; slug: string; name: string; badge: string | null;
  categorySlug: string; categoryName: string;
  bestSeller: boolean; newArrival: boolean;
  fromPriceCents: number; compareAtPriceCents: number | null;
  materials: string[]; available: number; stockStatus: StockStatus;
  image: ImageRef | null; hoverImage: ImageRef | null;
  avgRating: number | null; reviewCount: number;
  /** Set only when the product has exactly one sellable variant, so a card can "quick add" with no decision. */
  singleVariantId: string | null;
};

const AVG_RATING = sql<number | null>`(select round(avg(r.rating)::numeric, 1)::float from reviews r where r.product_id = ${products.id} and r.status = 'published')`;
const REVIEW_COUNT = sql<number>`(select count(*)::int from reviews r where r.product_id = ${products.id} and r.status = 'published')`;
/** Real units sold (not the curated `best_seller` flag), used for the "Best Selling" sort. */
const UNITS_SOLD = sql<number>`coalesce((select sum(oi.quantity)::int from order_items oi join orders o on o.id = oi.order_id where oi.product_id = ${products.id} and o.status <> 'cancelled'), 0)`;
const MIN_PRICE = sql<number>`min(${productVariants.sellingPriceCents})::int`;

function cardSelection() {
  return {
    id: products.id, slug: products.slug, name: products.name, badge: products.badge,
    categorySlug: categories.slug, categoryName: categories.name,
    bestSeller: products.bestSeller, newArrival: products.newArrival, featured: products.featured,
    createdAt: products.createdAt,
    fromPriceCents: MIN_PRICE,
    compareAtPriceCents: sql<number | null>`min(${productVariants.compareAtPriceCents})::int`,
    available: sql<number>`coalesce(sum(${inventory.stockQuantity} - ${inventory.reservedQuantity}), 0)::int`,
    reorderLevel: sql<number>`max(${inventory.reorderLevel})::int`,
    materials: sql<string[]>`array_agg(distinct ${productVariants.material})`,
    variantIds: sql<string[]>`array_agg(distinct ${productVariants.id})`,
    imageUrl: sql<string | null>`(select pi.url from product_images pi where pi.product_id = ${products.id} order by pi.position asc limit 1)`,
    imageAlt: sql<string | null>`(select pi.alt from product_images pi where pi.product_id = ${products.id} order by pi.position asc limit 1)`,
    hoverUrl: sql<string | null>`(select pi.url from product_images pi where pi.product_id = ${products.id} order by pi.position asc limit 1 offset 1)`,
    hoverAlt: sql<string | null>`(select pi.alt from product_images pi where pi.product_id = ${products.id} order by pi.position asc limit 1 offset 1)`,
    avgRating: AVG_RATING, reviewCount: REVIEW_COUNT, unitsSold: UNITS_SOLD,
  };
}

function toCard(r: Awaited<ReturnType<typeof baseCardQuery>>[number]): ProductCard {
  return {
    id: r.id, slug: r.slug, name: r.name, badge: r.badge, categorySlug: r.categorySlug, categoryName: r.categoryName,
    bestSeller: r.bestSeller, newArrival: r.newArrival, fromPriceCents: r.fromPriceCents, compareAtPriceCents: r.compareAtPriceCents,
    materials: r.materials, available: r.available, stockStatus: stockStatus(r.available, r.reorderLevel ?? 5),
    image: r.imageUrl ? { url: r.imageUrl, alt: r.imageAlt ?? r.name } : null,
    hoverImage: r.hoverUrl ? { url: r.hoverUrl, alt: r.hoverAlt ?? r.name } : null,
    avgRating: r.avgRating, reviewCount: r.reviewCount,
    singleVariantId: r.variantIds.length === 1 ? r.variantIds[0]! : null,
  };
}

function baseCardQuery(db: DbOrTx, where: SQL) {
  return db.select(cardSelection()).from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(collections, eq(collections.id, products.collectionId))
    .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.status, "active")))
    .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(where)
    .groupBy(products.id, categories.slug, categories.name);
}

/* ----------------------------------------------------------------- filter */
export type SortKey = "featured" | "best-selling" | "newest" | "price-asc" | "price-desc" | "rating";
export type CatalogFilters = {
  categorySlug?: string; collectionSlug?: string; tag?: string;
  special?: "best-sellers" | "new-arrivals";
  material?: string[]; gemstone?: string[]; size?: string[]; color?: string[];
  priceMinCents?: number; priceMaxCents?: number; inStockOnly?: boolean;
  sort?: SortKey; page?: number; perPage?: number;
};

/** A shopper's whole catalog is ~16 products; sorting and paging in JS after one grouped query is simpler
 *  and just as correct as pushing LIMIT/OFFSET through a HAVING clause, and avoids a second count query. */
export async function listProducts(db: DbOrTx, f: CatalogFilters = {}): Promise<{ items: ProductCard[]; total: number; page: number; perPage: number; pageCount: number }> {
  const page = Math.max(1, f.page ?? 1);
  const perPage = Math.min(48, Math.max(1, f.perPage ?? 12));

  const variantConds: SQL[] = [];
  if (f.material?.length) variantConds.push(sql`mv.material in (${f.material})`);
  if (f.gemstone?.length) variantConds.push(sql`mv.gemstone in (${f.gemstone})`);
  if (f.size?.length) variantConds.push(sql`mv.size in (${f.size})`);
  if (f.color?.length) variantConds.push(sql`mv.color in (${f.color})`);
  if (f.priceMinCents != null) variantConds.push(sql`mv.selling_price_cents >= ${f.priceMinCents}`);
  if (f.priceMaxCents != null) variantConds.push(sql`mv.selling_price_cents <= ${f.priceMaxCents}`);

  const conds: SQL[] = [eq(products.status, "active")];
  if (f.categorySlug) conds.push(eq(categories.slug, f.categorySlug));
  if (f.collectionSlug) conds.push(eq(collections.slug, f.collectionSlug));
  if (f.tag) conds.push(sql`${f.tag} = any(${products.tags})`);
  if (f.special === "best-sellers") conds.push(eq(products.bestSeller, true));
  if (f.special === "new-arrivals") conds.push(eq(products.newArrival, true));
  if (variantConds.length) conds.push(sql`exists (select 1 from product_variants mv where mv.product_id = ${products.id} and mv.status = 'active' and ${sql.join(variantConds, sql` and `)})`);

  const rows = await baseCardQuery(db, and(...conds)!);
  const filtered = f.inStockOnly ? rows.filter((r) => r.available > 0) : rows;

  const sort = f.sort ?? "featured";
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case "best-selling": return b.unitsSold - a.unitsSold;
      case "newest": return b.createdAt.getTime() - a.createdAt.getTime();
      case "price-asc": return a.fromPriceCents - b.fromPriceCents;
      case "price-desc": return b.fromPriceCents - a.fromPriceCents;
      case "rating": return (b.avgRating ?? -1) - (a.avgRating ?? -1) || b.reviewCount - a.reviewCount;
      default: return (Number(b.featured) - Number(a.featured)) || (Number(b.bestSeller) - Number(a.bestSeller)) || a.name.localeCompare(b.name);
    }
  });

  const total = sorted.length;
  const page1 = Math.min(page, Math.max(1, Math.ceil(total / perPage)));
  const items = sorted.slice((page1 - 1) * perPage, page1 * perPage).map(toCard);
  return { items, total, page: page1, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)) };
}

export type Facets = { materials: string[]; gemstones: string[]; sizes: string[]; priceMinCents: number; priceMaxCents: number };
type TaxonomyFilters = Pick<CatalogFilters, "categorySlug" | "collectionSlug" | "tag" | "special">;

/** Filter facets for a taxonomy scope (category/collection/tag), not conditioned on the shopper's other
 *  filter choices — simple, and correct enough for a boutique catalog of a few hundred variants. */
export async function getFacets(db: DbOrTx, base: TaxonomyFilters): Promise<Facets> {
  const conds: SQL[] = [eq(products.status, "active"), eq(productVariants.status, "active")];
  if (base.categorySlug) conds.push(eq(categories.slug, base.categorySlug));
  if (base.collectionSlug) conds.push(eq(collections.slug, base.collectionSlug));
  if (base.tag) conds.push(sql`${base.tag} = any(${products.tags})`);
  if (base.special === "best-sellers") conds.push(eq(products.bestSeller, true));
  if (base.special === "new-arrivals") conds.push(eq(products.newArrival, true));

  const rows = await db.select({ material: productVariants.material, gemstone: productVariants.gemstone, size: productVariants.size, price: productVariants.sellingPriceCents })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(collections, eq(collections.id, products.collectionId))
    .where(and(...conds)!);

  const MATERIAL_ORDER = ["yg", "wg", "vm", "ss"];
  const materials = [...new Set(rows.map((r) => r.material))].sort((a, b) => (MATERIAL_ORDER.indexOf(a) + 1 || 99) - (MATERIAL_ORDER.indexOf(b) + 1 || 99));
  const gemstones = [...new Set(rows.map((r) => r.gemstone).filter((g): g is string => !!g))].sort();
  const sizes = [...new Set(rows.map((r) => r.size).filter((s): s is string => !!s))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const prices = rows.map((r) => r.price);
  return { materials, gemstones, sizes, priceMinCents: prices.length ? Math.min(...prices) : 0, priceMaxCents: prices.length ? Math.max(...prices) : 0 };
}

export async function getBestSellers(db: DbOrTx, limit = 8): Promise<ProductCard[]> {
  return (await listProducts(db, { special: "best-sellers", sort: "best-selling", perPage: limit })).items;
}
export async function getNewArrivals(db: DbOrTx, limit = 8): Promise<ProductCard[]> {
  return (await listProducts(db, { special: "new-arrivals", sort: "newest", perPage: limit })).items;
}
export async function getFeaturedProducts(db: DbOrTx, limit = 4): Promise<ProductCard[]> {
  const rows = await baseCardQuery(db, and(eq(products.status, "active"), eq(products.featured, true))!);
  return rows.slice(0, limit).map(toCard);
}
export async function getProductCardsByIds(db: DbOrTx, ids: string[]): Promise<ProductCard[]> {
  if (!ids.length) return [];
  const rows = await baseCardQuery(db, and(eq(products.status, "active"), inArray(products.id, ids))!);
  const byId = new Map(rows.map((r) => [r.id, toCard(r)]));
  return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
}

/** The right thumbnail for a specific variant (matching its metal), for the cart and order confirmations —
 *  not just the product's default image, which is always the first material's front shot. */
export async function getVariantImages(db: DbOrTx, variantIds: string[]): Promise<Map<string, ImageRef | null>> {
  if (!variantIds.length) return new Map();
  const variantRows = await db.select({ variantId: productVariants.id, productId: productVariants.productId, material: productVariants.material })
    .from(productVariants).where(inArray(productVariants.id, variantIds));
  const productIds = [...new Set(variantRows.map((r) => r.productId))];
  const imageRows = productIds.length ? await db.select({
    productId: productImages.productId, url: productImages.url, alt: productImages.alt, position: productImages.position, variantMaterial: productVariants.material,
  }).from(productImages)
    .leftJoin(productVariants, eq(productVariants.id, productImages.variantId))
    .where(inArray(productImages.productId, productIds)).orderBy(asc(productImages.position)) : [];

  const byProduct = new Map<string, typeof imageRows>();
  for (const img of imageRows) byProduct.set(img.productId, [...(byProduct.get(img.productId) ?? []), img]);

  const result = new Map<string, ImageRef | null>();
  for (const v of variantRows) {
    const imgs = byProduct.get(v.productId) ?? [];
    const primaryMaterial = imgs.find((i) => i.variantMaterial)?.variantMaterial ?? null;
    const match = imgs.find((i) => (i.variantMaterial ?? primaryMaterial) === v.material) ?? imgs[0];
    result.set(v.variantId, match ? { url: match.url, alt: match.alt } : null);
  }
  return result;
}

/* ------------------------------------------------------------- taxonomy */
export type MaterialOption = { slug: string; name: string };
export async function getMaterialOptions(db: DbOrTx): Promise<MaterialOption[]> {
  const rows = await db.select({ slug: materials.code, name: materials.name }).from(materials).orderBy(asc(materials.position));
  return rows;
}

export type CategorySummary = { slug: string; name: string; count: number; imageUrl: string | null };
export async function getCategories(db: DbOrTx): Promise<CategorySummary[]> {
  const rows = await db.select({
    slug: categories.slug, name: categories.name, position: categories.position, imageUrl: categories.imageUrl,
    count: sql<number>`count(distinct ${products.id})::int`,
  }).from(categories)
    .leftJoin(products, and(eq(products.categoryId, categories.id), eq(products.status, "active")))
    .groupBy(categories.id).orderBy(asc(categories.position));
  return rows.map(({ slug, name, count, imageUrl }) => ({ slug, name, count, imageUrl }));
}

export type CollectionSummary = { slug: string; name: string; description: string; count: number };
export async function getCollections(db: DbOrTx): Promise<CollectionSummary[]> {
  const rows = await db.select({
    slug: collections.slug, name: collections.name, description: collections.description,
    count: sql<number>`count(distinct ${products.id})::int`,
  }).from(collections)
    .leftJoin(products, and(eq(products.collectionId, collections.id), eq(products.status, "active")))
    .groupBy(collections.id).orderBy(asc(collections.name));
  return rows;
}

export type ResolvedCollection = { title: string; description: string; filters: Pick<CatalogFilters, "categorySlug" | "collectionSlug" | "tag" | "special">; collectionId?: string };

/** A `/collections/[slug]` route can mean a category, an editorial collection, a curated tag, or a special
 *  view — resolved in that order, so the same shareable URL always means the same thing. */
export async function resolveCollection(db: DbOrTx, slug: string): Promise<ResolvedCollection | null> {
  const [byCategory] = await db.select({ name: categories.name }).from(categories).where(eq(categories.slug, slug));
  if (byCategory) return { title: byCategory.name, description: `${byCategory.name}, designed to be worn every day.`, filters: { categorySlug: slug } };
  const [byCollection] = await db.select({ id: collections.id, name: collections.name, description: collections.description }).from(collections).where(eq(collections.slug, slug));
  if (byCollection) return { title: byCollection.name, description: byCollection.description, filters: { collectionSlug: slug }, collectionId: byCollection.id };
  const special: Record<string, { title: string; description: string; filters: ResolvedCollection["filters"] }> = {
    "best-sellers": { title: "Best Sellers", description: "The pieces our customers reach for again and again.", filters: { special: "best-sellers" } },
    "new-arrivals": { title: "New Arrivals", description: "The latest additions to the studio.", filters: { special: "new-arrivals" } },
    "all-jewelry": { title: "All Jewelry", description: "The full studio collection, in one place.", filters: {} },
    everyday: { title: "Everyday", description: "Pieces made to be worn every day, without a second thought.", filters: { tag: "everyday" } },
    wedding: { title: "Wedding", description: "Solitaires, eternity bands and pieces for the day itself.", filters: { tag: "wedding" } },
    gifts: { title: "Gifts", description: "Considered pieces for the people who matter.", filters: { tag: "gifts" } },
    statement: { title: "Statement", description: "Jewelry that isn't shy about being noticed.", filters: { tag: "statement" } },
  };
  return special[slug] ?? null;
}

/* -------------------------------------------------------------- product */
export type VariantOption = {
  id: string; sku: string; material: string; color: string | null; size: string | null; gemstone: string | null;
  priceCents: number; compareAtPriceCents: number | null; available: number; stockStatus: StockStatus;
};
export type ProductImageRow = ImageRef & { variantId: string | null; variantMaterial: string | null; position: number };
export type ProductDetail = {
  id: string; slug: string; name: string; shortDescription: string; description: string; details: string[]; tags: string[];
  categoryId: string; categorySlug: string; categoryName: string;
  collectionId: string | null; collectionSlug: string | null; collectionName: string | null;
  badge: string | null; bestSeller: boolean; newArrival: boolean;
  seoTitle: string | null; seoDescription: string | null;
  images: ProductImageRow[]; variants: VariantOption[];
  avgRating: number | null; reviewCount: number;
};

export async function getProductBySlug(db: DbOrTx, slug: string): Promise<ProductDetail | null> {
  const [p] = await db.select({
    id: products.id, slug: products.slug, name: products.name, shortDescription: products.shortDescription, description: products.description,
    details: products.details, tags: products.tags,
    categoryId: products.categoryId, categorySlug: categories.slug, categoryName: categories.name,
    collectionId: products.collectionId, collectionSlug: collections.slug, collectionName: collections.name,
    badge: products.badge, bestSeller: products.bestSeller, newArrival: products.newArrival,
    seoTitle: products.seoTitle, seoDescription: products.seoDescription,
  }).from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(collections, eq(collections.id, products.collectionId))
    .where(and(eq(products.slug, slug), eq(products.status, "active")));
  if (!p) return null;

  const variantRows = await db.select({
    id: productVariants.id, sku: productVariants.sku, material: productVariants.material, color: productVariants.color,
    size: productVariants.size, gemstone: productVariants.gemstone, priceCents: productVariants.sellingPriceCents,
    compareAtPriceCents: productVariants.compareAtPriceCents,
    stockQuantity: inventory.stockQuantity, reservedQuantity: inventory.reservedQuantity, reorderLevel: inventory.reorderLevel,
  }).from(productVariants)
    .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(eq(productVariants.productId, p.id), eq(productVariants.status, "active")))
    .orderBy(asc(productVariants.sellingPriceCents));

  const images = await db.select({
    url: productImages.url, alt: productImages.alt, variantId: productImages.variantId, position: productImages.position,
    variantMaterial: productVariants.material,
  }).from(productImages)
    .leftJoin(productVariants, eq(productVariants.id, productImages.variantId))
    .where(eq(productImages.productId, p.id)).orderBy(asc(productImages.position));

  const [ratingRow] = await db.select({ avg: sql<number | null>`round(avg(${reviews.rating})::numeric, 1)::float`, count: sql<number>`count(*)::int` })
    .from(reviews).where(and(eq(reviews.productId, p.id), eq(reviews.status, "published")));

  return {
    ...p, images,
    variants: variantRows.map((v) => {
      const available = availableStock(v);
      return { id: v.id, sku: v.sku, material: v.material, color: v.color, size: v.size, gemstone: v.gemstone,
        priceCents: v.priceCents, compareAtPriceCents: v.compareAtPriceCents, available, stockStatus: stockStatus(available, v.reorderLevel) };
    }),
    avgRating: ratingRow?.avg ?? null, reviewCount: ratingRow?.count ?? 0,
  };
}

export async function getRelatedProducts(db: DbOrTx, product: Pick<ProductDetail, "id" | "categoryId">, limit = 4): Promise<ProductCard[]> {
  const rows = await baseCardQuery(db, and(eq(products.status, "active"), eq(products.categoryId, product.categoryId), sql`${products.id} <> ${product.id}`)!);
  return rows.sort((a, b) => Number(b.bestSeller) - Number(a.bestSeller)).slice(0, limit).map(toCard);
}

/** Complementary pieces from the same editorial collection but a different category, to complete a look. */
export async function getShopTheLook(db: DbOrTx, product: Pick<ProductDetail, "id" | "categoryId" | "collectionId">, limit = 3): Promise<ProductCard[]> {
  if (!product.collectionId) return [];
  const rows = await baseCardQuery(db, and(eq(products.status, "active"), eq(products.collectionId, product.collectionId), sql`${products.categoryId} <> ${product.categoryId}`)!);
  return rows.slice(0, limit).map(toCard);
}

/* --------------------------------------------------------------- reviews */
export type ReviewRow = { id: string; rating: number; title: string; body: string; authorName: string; createdAt: Date; verifiedPurchase: boolean };
export async function getReviews(db: DbOrTx, productId: string, page = 1, perPage = 8): Promise<{ items: ReviewRow[]; total: number; distribution: Record<1 | 2 | 3 | 4 | 5, number> }> {
  const rows = await db.select({
    id: reviews.id, rating: reviews.rating, title: reviews.title, body: reviews.body, authorName: reviews.authorName,
    createdAt: reviews.createdAt, verifiedPurchase: sql<boolean>`${reviews.orderId} is not null`,
  }).from(reviews).where(and(eq(reviews.productId, productId), eq(reviews.status, "published"))).orderBy(desc(reviews.createdAt));
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const r of rows) distribution[r.rating as 1 | 2 | 3 | 4 | 5]++;
  return { items: rows.slice((page - 1) * perPage, page * perPage), total: rows.length, distribution };
}

/* ---------------------------------------------------------------- search */
export type SearchResult = { products: ProductCard[]; categories: CategorySummary[] };
export async function searchProducts(db: DbOrTx, query: string, limit = 12): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < 2) return { products: [], categories: [] };
  const like = `%${q}%`;
  const matchesSku = sql`exists (select 1 from product_variants mv where mv.product_id = ${products.id} and mv.sku ilike ${like})`;
  // Whole-word match for description/category text, so "ring" doesn't match "Earrings" or "wearing" —
  // the product name still matches by substring, since short product names are meant to match partially.
  const escaped = q.replace(/[\\.*+?^${}()|[\]]/g, "\\$&");
  const word = `\\m${escaped}\\M`;
  const cond = and(
    eq(products.status, "active"),
    sql`(${products.name} ilike ${like} or ${products.shortDescription} ~* ${word} or ${products.description} ~* ${word} or ${categories.name} ~* ${word} or ${q} = any(${products.tags}) or ${matchesSku})`,
  )!;
  const rows = await baseCardQuery(db, cond);
  const allCategories = await getCategories(db);
  const wordRe = new RegExp(`\\b${escaped}`, "i");
  return {
    products: rows.slice(0, limit).map(toCard),
    categories: allCategories.filter((c) => wordRe.test(c.name)),
  };
}
