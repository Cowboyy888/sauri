import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { getCustomerReviews, getReviewableProducts } from "@/lib/reviews/service";
import { dateShort } from "@/lib/format";
import { WriteReviewForm } from "@/components/storefront/account/write-review-form";

export const metadata: Metadata = { title: "My Reviews" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { pending: "Pending moderation", published: "Published", rejected: "Not approved", hidden: "Hidden" };

export default async function ReviewsPage() {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) redirect("/account?next=/account/reviews");
  const [reviewable, mine] = await Promise.all([getReviewableProducts(db, customer.id), getCustomerReviews(db, customer.id)]);

  return (
    <div>
      <h1 className="font-display text-3xl">My Reviews</h1>
      {reviewable.length > 0 && (
        <section className="mt-8">
          <h2 className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Products you can review</h2>
          <div className="mt-3 grid gap-4">
            {reviewable.map((r) => <WriteReviewForm key={`${r.orderId}-${r.productId}`} orderId={r.orderId} productId={r.productId} productName={r.productName} />)}
          </div>
        </section>
      )}
      <section className="mt-10">
        <h2 className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Your reviews</h2>
        <ul className="mt-3 divide-y divide-ink/10 font-sans text-sm">
          {mine.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <p><span className="text-champagne">{"★".repeat(r.rating)}</span><span className="text-ink/25">{"★".repeat(5 - r.rating)}</span> <b className="font-medium">{r.title}</b></p>
                <span className="text-xs uppercase tracking-wide text-ink/40">{STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
              <p className="mt-1 text-ink/60">{r.productName}</p>
              <p className="mt-1 text-ink/75">{r.body}</p>
              <p className="mt-1 text-xs text-ink/40">{dateShort(r.createdAt)}</p>
            </li>
          ))}
          {!mine.length && <p className="py-4 text-ink/50">You haven&rsquo;t written a review yet.</p>}
        </ul>
      </section>
    </div>
  );
}
