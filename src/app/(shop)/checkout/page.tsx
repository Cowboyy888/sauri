import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getActiveShippingMethods } from "@/lib/storefront/shipping";
import { CheckoutFlow } from "@/components/storefront/checkout/checkout-flow";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const shippingMethods = await getActiveShippingMethods(getDb());
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl">Checkout</h1>
      <div className="mt-8">
        <CheckoutFlow shippingMethods={shippingMethods} />
      </div>
    </div>
  );
}
