import type { Metadata } from "next";
import { BRAND } from "@/lib/storefront/brand";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl">Terms of Service</h1>
      <div className="mt-8 space-y-5 font-sans text-sm leading-relaxed text-ink/70">
        <p>By placing an order with {BRAND.name}, you agree to pay the listed price at checkout, which is calculated and confirmed on our servers. Prices, availability and product details may change without notice.</p>
        <p>Orders are subject to acceptance and inventory availability; we&rsquo;ll notify you if an item can&rsquo;t be fulfilled. See our Returns and Shipping pages for the terms that apply after your order ships.</p>
      </div>
    </article>
  );
}
