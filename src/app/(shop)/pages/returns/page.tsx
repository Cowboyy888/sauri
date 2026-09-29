import Link from "next/link";
import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getReturnPolicy } from "@/lib/returns/service";
import { categories } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Returns" };
export const dynamic = "force-dynamic";

const SHIPPING_COPY: Record<string, string> = {
  customer: "You're responsible for the cost of return shipping.",
  company: "We cover the cost of return shipping.",
  free: "Return shipping is always free.",
};

export default async function ReturnsPage() {
  const db = getDb();
  const [policy, cats] = await Promise.all([getReturnPolicy(db), db.select({ slug: categories.slug, name: categories.name }).from(categories).orderBy(asc(categories.position))]);
  const eligibleNames = policy.eligibleCategorySlugs ? cats.filter((c) => policy.eligibleCategorySlugs!.includes(c.slug)).map((c) => c.name) : null;

  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-ink/40">Returns</p>
      <h1 className="mt-3 font-display text-4xl">{policy.refundEnabled ? `Easy returns, ${policy.returnWindowDays} days` : "Returns"}</h1>
      <div className="mt-8 space-y-6 font-sans text-[15px] leading-relaxed text-ink/75">
        {policy.refundEnabled ? (
          <p>If something isn&rsquo;t right, you have {policy.returnWindowDays} days from delivery to return it{policy.exchangeEnabled ? " for a refund or exchange" : " for a full refund to your original payment method"}. Pieces should be unworn, in their original packaging.</p>
        ) : (
          <p>We&rsquo;re not currently accepting returns. If there&rsquo;s a problem with your order, please <Link href="/pages/contact" className="underline underline-offset-2">contact us</Link>.</p>
        )}
        {policy.refundEnabled && (
          <>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Sign in and open the order from your <Link href="/account/orders" className="underline underline-offset-2">order history</Link>.</li>
              <li>Let us know which item you&rsquo;re returning and why.</li>
              <li>{SHIPPING_COPY[policy.returnShippingPolicy]}</li>
            </ol>
            <p>Refunds are issued once the return is received and inspected.{policy.finalSaleTags.length ? " Final-sale items can't be returned." : ""}{eligibleNames ? ` Returns are currently accepted only for: ${eligibleNames.join(", ")}.` : ""}</p>
          </>
        )}
      </div>
    </article>
  );
}
