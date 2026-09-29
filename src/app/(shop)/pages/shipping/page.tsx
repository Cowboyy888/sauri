import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getActiveShippingMethods } from "@/lib/storefront/shipping";
import { STORE } from "@/lib/config";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Shipping" };
export const dynamic = "force-dynamic";

export default async function ShippingPage() {
  const methods = await getActiveShippingMethods(getDb());
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-ink/40">Shipping</p>
      <h1 className="mt-3 font-display text-4xl">Shipping information</h1>
      <div className="mt-8 space-y-6 font-sans text-[15px] leading-relaxed text-ink/75">
        <p>Every order ships insured and tracked. Complimentary shipping applies automatically on orders over {formatMoney(STORE.freeShippingThresholdCents)} on eligible methods.</p>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b border-ink/15 text-left"><th className="py-2 font-medium">Method</th><th className="py-2 font-medium">Cost</th><th className="py-2 font-medium">Delivery</th></tr></thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.id} className="border-b border-ink/10 last:border-0">
                <td className="py-2">{m.name}</td>
                <td className="py-2">{m.priceCents === 0 ? "Free" : formatMoney(m.priceCents)}{m.waivableAboveThreshold ? `, free over ${formatMoney(STORE.freeShippingThresholdCents)}` : ""}</td>
                <td className="py-2">{m.estimatedMinDays}–{m.estimatedMaxDays} business days</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>You&rsquo;ll receive a tracking link by email as soon as your order ships, and can always check its status from your <Link href="/account/orders" className="underline underline-offset-2">order history</Link>.</p>
      </div>
    </article>
  );
}
