import { Star } from "lucide-react";
import { cn } from "@/components/ui/cn";

export function RatingStars({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const cls = size === "md" ? "size-5" : "size-3.5";
  return (
    <div className="flex gap-0.5" role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn(cls, i < Math.round(rating) ? "fill-champagne text-champagne" : "text-ink/20")} />
      ))}
    </div>
  );
}
