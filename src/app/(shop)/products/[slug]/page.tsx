import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getProductBySlug, getRelatedProducts, getReviews, getShopTheLook } from "@/lib/storefront/catalog";
import { Breadcrumb } from "@/components/storefront/shop/breadcrumb";
import { ProductInteractive } from "@/components/storefront/product/product-interactive";
import { ReviewsSection } from "@/components/storefront/product/reviews-section";
import { RelatedGrid } from "@/components/storefront/product/related-grid";
import { RecentlyViewed } from "@/components/storefront/product/recently-viewed";
import { TrackView } from "@/components/storefront/product/track-view";
import { BRAND } from "@/lib/storefront/brand";

export const revalidate = 60;
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(getDb(), slug);
  if (!product) return {};
  const title = product.seoTitle ?? `${product.name} | ${BRAND.name}`;
  const description = product.seoDescription ?? product.shortDescription;
  return {
    title, description, alternates: { canonical: `/products/${slug}` },
    openGraph: { title, description, images: product.images[0] ? [{ url: product.images[0].url }] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const db = getDb();
  const product = await getProductBySlug(db, slug);
  if (!product) notFound();

  const [related, shopTheLook, reviews] = await Promise.all([
    getRelatedProducts(db, product, 4),
    getShopTheLook(db, product, 3),
    getReviews(db, product.id, 1, 10),
  ]);

  const jsonLd = {
    "@context": "https://schema.org", "@type": "Product", name: product.name, description: product.shortDescription, sku: product.variants[0]?.sku,
    image: product.images.map((i) => i.url),
    offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: (Math.min(...product.variants.map((v) => v.priceCents)) / 100).toFixed(2), highPrice: (Math.max(...product.variants.map((v) => v.priceCents)) / 100).toFixed(2), offerCount: product.variants.length },
    ...(product.reviewCount > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: product.avgRating, reviewCount: product.reviewCount } } : {}),
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <TrackView productId={product.id} />
      <Breadcrumb items={[{ label: product.categoryName, href: `/collections/${product.categorySlug}` }, { label: product.name }]} />
      <div className="mt-6">
        <ProductInteractive product={product} />
      </div>

      {shopTheLook.length > 0 && <RelatedGrid title="Shop the Look" products={shopTheLook} />}

      <ReviewsSection avgRating={product.avgRating} reviewCount={reviews.total} distribution={reviews.distribution} reviews={reviews.items} />

      <RelatedGrid title="You May Also Like" products={related} />
      <RecentlyViewed excludeId={product.id} />
    </div>
  );
}
