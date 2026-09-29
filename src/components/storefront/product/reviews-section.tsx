import { RatingStars } from "@/components/storefront/shop/rating-stars";
import { dateShort } from "@/lib/format";
import type { ReviewRow } from "@/lib/storefront/catalog";

export function ReviewsSection({ avgRating, reviewCount, distribution, reviews }: {
  avgRating: number | null; reviewCount: number; distribution: Record<1 | 2 | 3 | 4 | 5, number>; reviews: ReviewRow[];
}) {
  return (
    <section id="reviews" className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h2 className="font-display text-2xl">Customer Reviews</h2>
      {reviewCount === 0 ? (
        <p className="mt-4 font-sans text-sm text-ink/55">No reviews yet — be the first to share your experience.</p>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:items-start">
            <div className="shrink-0 text-center sm:text-left">
              <p className="font-display text-5xl">{avgRating?.toFixed(1)}</p>
              <RatingStars rating={avgRating ?? 0} size="md" />
              <p className="mt-1 font-sans text-xs text-ink/50">{reviewCount} review{reviewCount === 1 ? "" : "s"}</p>
            </div>
            <div className="flex-1 space-y-1.5">
              {([5, 4, 3, 2, 1] as const).map((star) => (
                <div key={star} className="flex items-center gap-2 font-sans text-xs text-ink/60">
                  <span className="w-3">{star}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-ink/10">
                    <div className="h-full rounded-full bg-champagne" style={{ width: `${reviewCount ? (distribution[star] / reviewCount) * 100 : 0}%` }} />
                  </div>
                  <span className="w-6 text-right">{distribution[star]}</span>
                </div>
              ))}
            </div>
          </div>

          <ul className="mt-10 space-y-8 divide-y divide-ink/10">
            {reviews.map((r) => (
              <li key={r.id} className="pt-8 first:pt-0">
                <div className="flex items-center justify-between">
                  <RatingStars rating={r.rating} />
                  <span className="font-sans text-xs text-ink/40">{dateShort(r.createdAt)}</span>
                </div>
                <p className="mt-2 font-display text-base">{r.title}</p>
                <p className="mt-1 font-sans text-sm leading-relaxed text-ink/70">{r.body}</p>
                <p className="mt-2 font-sans text-xs text-ink/45">
                  {r.authorName}{r.verifiedPurchase && <span className="ml-2 text-champagne">Verified purchase</span>}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
