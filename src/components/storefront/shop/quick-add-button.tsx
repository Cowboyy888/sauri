"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useCart } from "@/components/storefront/cart/cart-provider";

/** A product with exactly one active, in-stock variant can be added without a decision. Anything else sends
 *  the shopper to the product page to choose material, size or gemstone first (brief §25). */
export function QuickAddButton({ productSlug, singleVariantId, disabled, className }: { productSlug: string; singleVariantId: string | null; disabled?: boolean; className?: string }) {
  const { addLine } = useCart();
  const base = "shop-press inline-flex h-9 items-center justify-center gap-1.5 border border-ink bg-ink px-3 font-sans text-xs uppercase tracking-[0.12em] text-warm-white transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:border-ink/20 disabled:bg-transparent disabled:text-ink/35";

  if (disabled) return <button type="button" disabled className={cn(base, className)}>Sold out</button>;

  if (singleVariantId) {
    return (
      <button type="button" onClick={() => addLine(singleVariantId, 1)} className={cn(base, className)}>
        <Plus className="size-3.5" /> Quick add
      </button>
    );
  }
  return (
    <Link href={`/products/${productSlug}`} className={cn(base, className)}>
      Select options
    </Link>
  );
}
