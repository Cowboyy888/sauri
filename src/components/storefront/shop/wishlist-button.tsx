"use client";
import { Heart } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/components/ui/cn";
import { useWishlist } from "@/components/storefront/wishlist/wishlist-provider";

export function WishlistButton({ productId, className, size = "md" }: { productId: string; className?: string; size?: "sm" | "md" }) {
  const { has, toggle } = useWishlist();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const active = has(productId);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? "Remove from wishlist" : "Add to wishlist"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await toggle(productId);
          if (result === "signin-required") router.push(`/account?next=${encodeURIComponent(pathname)}`);
        })
      }
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-ink/15 bg-warm-white/90 text-ink backdrop-blur transition-colors hover:border-ink/30 disabled:opacity-60",
        size === "sm" ? "size-8" : "size-10",
        className,
      )}
    >
      <Heart className={cn(size === "sm" ? "size-4" : "size-[18px]", active && "fill-ink")} />
    </button>
  );
}
