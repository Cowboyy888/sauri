import type { Metadata } from "next";
import { BRAND } from "@/lib/storefront/brand";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl">Privacy Policy</h1>
      <div className="mt-8 space-y-5 font-sans text-sm leading-relaxed text-ink/70">
        <p>{BRAND.name} collects the information needed to fulfill your order — name, email, shipping address and order history — and nothing more than that. We never sell customer data.</p>
        <p>Account access is handled through a secure, passwordless sign-in link sent to your email. Payment details are processed by our payment provider and never stored on our servers.</p>
        <p>You can request a copy of your data or ask us to delete your account at any time by contacting us.</p>
      </div>
    </article>
  );
}
