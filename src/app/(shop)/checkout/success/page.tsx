import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getOrderConfirmation } from "@/lib/storefront/account";
import { formatMoney } from "@/lib/money";
import { dateShort } from "@/lib/format";

export const metadata: Metadata = { title: "Order Confirmed", robots: { index: false } };
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ order?: string }> };

const STATUS_LABEL: Record<string, string> = { pending: "Payment pending", paid: "Paid", processing: "Processing" };

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { order: orderId } = await searchParams;
  const order = orderId && /^[0-9a-f-]{36}$/i.test(orderId) ? await getOrderConfirmation(getDb(), orderId) : null;

  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <h1 className="font-display text-3xl">Thank you for your order</h1>
        <p className="mt-3 font-sans text-sm text-ink/60">We couldn&rsquo;t find that confirmation, but if payment succeeded you&rsquo;ll find it in your order history.</p>
        <Link href="/account/orders" className="mt-6 inline-block border border-ink px-6 py-3 font-sans text-xs uppercase tracking-widest">View order history</Link>
      </div>
    );
  }

  const addr = order.shippingAddress;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-champagne">Order confirmed</p>
      <h1 className="mt-3 font-display text-4xl">Thank you for your order.</h1>
      <p className="mt-3 font-sans text-sm text-ink/60">A confirmation has been sent — {STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}.</p>

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-2 border-y border-ink/10 py-4">
        <div><p className="font-sans text-xs uppercase tracking-widest text-ink/40">Order number</p><p className="font-display text-lg">{order.orderNumber}</p></div>
        <div><p className="font-sans text-xs uppercase tracking-widest text-ink/40">Order date</p><p className="font-sans text-sm text-ink">{dateShort(order.placedAt)}</p></div>
        <div><p className="font-sans text-xs uppercase tracking-widest text-ink/40">Total</p><p className="font-display text-lg">{formatMoney(order.totalCents)}</p></div>
      </div>

      <ul className="mt-6 divide-y divide-ink/10">
        {order.items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-4 py-3 font-sans text-sm">
            <div><p className="text-ink">{i.productNameSnapshot}</p><p className="text-ink/50">{i.variantSnapshot.label} · Qty {i.quantity}</p></div>
            <p>{formatMoney(i.lineTotalCents)}</p>
          </li>
        ))}
      </ul>

      {addr && (
        <div className="mt-8">
          <p className="font-sans text-xs uppercase tracking-widest text-ink/40">Shipping to</p>
          <p className="mt-2 font-sans text-sm text-ink/70">
            {addr.firstName} {addr.lastName}<br />
            {addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}<br />
            {addr.city}{addr.state ? `, ${addr.state}` : ""} {addr.postalCode}<br />
            {addr.country}
          </p>
        </div>
      )}

      <p className="mt-8 font-sans text-sm text-ink/60">Questions about your order? <Link href="/pages/contact" className="underline underline-offset-2">Contact us</Link>.</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/account/orders" className="border border-ink px-6 py-3 font-sans text-xs uppercase tracking-widest">View Order</Link>
        <Link href="/collections/new-arrivals" className="px-6 py-3 font-sans text-xs uppercase tracking-widest text-ink/60 hover:text-ink">Continue Shopping</Link>
      </div>
    </div>
  );
}
