import Image from "next/image";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import type { ProductCard as ProductCardData } from "@/lib/storefront/catalog";
import { MATERIAL_NAME } from "@/lib/format";
import { Price } from "./price";
import { ProductBadge, StockLabel } from "./badge";
import { WishlistButton } from "./wishlist-button";
import { QuickAddButton } from "./quick-add-button";

export function ProductCard({ product, className }: { product: ProductCardData; className?: string }) {
  const materialLabel = product.materials.length === 1 ? (MATERIAL_NAME[product.materials[0]!] ?? product.materials[0]) : `${product.materials.length} metals`;
  const badge = product.badge ?? (product.stockStatus === "LOW_STOCK" ? "Low stock" : product.newArrival ? "New" : product.bestSeller ? "Best seller" : null);

  return (
    <article className={cn("shop-scroll-in group relative flex flex-col", className)}>
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-beige-soft">
        <Link href={`/products/${product.slug}`} className="absolute inset-0" aria-label={product.name}>
          {product.image ? (
            <Image src={product.image.url} alt={product.image.alt} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover transition-[opacity,transform] duration-700 group-hover:scale-105 group-hover:opacity-0" />
          ) : (
            <div className="flex size-full items-center justify-center font-display text-2xl text-ink/20">{product.name[0]}</div>
          )}
          {product.hoverImage && (
            <Image src={product.hoverImage.url} alt="" aria-hidden fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover opacity-0 transition-[opacity,transform] duration-700 group-hover:scale-105 group-hover:opacity-100" />
          )}
        </Link>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          {badge ? <ProductBadge label={badge} className="pointer-events-auto" /> : <span />}
          <WishlistButton productId={product.id} size="sm" className="pointer-events-auto" />
        </div>
        <div className="absolute inset-x-3 bottom-3 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
          <QuickAddButton productSlug={product.slug} singleVariantId={product.available > 0 ? product.singleVariantId : null} disabled={product.stockStatus === "OUT_OF_STOCK"} className="w-full" />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <p className="font-sans text-[11px] uppercase tracking-[0.14em] text-ink/45">{materialLabel}</p>
        <Link href={`/products/${product.slug}`} className="font-display text-[17px] leading-snug text-ink hover:text-ink/70">{product.name}</Link>
        <Price cents={product.fromPriceCents} compareAtCents={product.compareAtPriceCents} className="text-[14px] text-ink/80" />
        <StockLabel status={product.stockStatus} available={product.available} className="mt-0.5" />
      </div>
    </article>
  );
}
