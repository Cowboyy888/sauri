import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { getCustomerOrder } from "@/lib/storefront/account";
import { formatMoney } from "@/lib/money";
import { dateTimeFull } from "@/lib/format";
import { OrderTimeline } from "@/components/storefront/account/order-timeline";
import { CancelOrderButton } from "@/components/storefront/account/cancel-order";

export const metadata: Metadata = { title: "Order Details" };
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

const STATUS_LABEL: Record<string, string> = { pending: "Payment pending", paid: "Paid", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded" };
const PAYMENT_LABEL: Record<string, string> = { unpaid: "unpaid", paid: "paid", failed: "failed", refunded: "refunded", partially_refunded: "partially refunded" };

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) redirect(`/account?next=/account/orders/${id}`);
  const order = await getCustomerOrder(db, customer.id, id);
  if (!order) notFound();

  return (
    <div>
      <Link href="/account/orders" className="font-sans text-xs uppercase tracking-widest text-ink/50 hover:text-ink">← Order history</Link>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl">{order.orderNumber}</h1>
        <p className="font-sans text-sm text-ink/55">{dateTimeFull(order.placedAt)}</p>
      </div>
      <p className="mt-1 font-sans text-sm text-ink/60">{STATUS_LABEL[order.status] ?? order.status} · Payment {PAYMENT_LABEL[order.paymentStatus] ?? order.paymentStatus}</p>
      {order.trackingNumber && !order.packages.length && (
        <p className="mt-2 font-sans text-sm text-ink">{order.carrier ? `${order.carrier} tracking: ` : "Tracking: "}<span className="font-medium">{order.trackingNumber}</span></p>
      )}
      {order.packages.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          {order.packages.map((p) => (
            <p key={p.id} className="font-sans text-sm text-ink">
              {order.packages.length > 1 ? `Package ${p.packageNumber}: ` : ""}
              {p.carrier ? `${p.carrier} — ` : ""}
              {p.trackingNumber ? (p.trackingUrl ? <a href={p.trackingUrl} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">{p.trackingNumber}</a> : <span className="font-medium">{p.trackingNumber}</span>) : "Preparing for shipment"}
            </p>
          ))}
        </div>
      )}
      {order.returnRequests.length > 0 && (
        <p className="mt-2 font-sans text-sm text-ink/60">Return status: <Link href={`/account/orders/${order.id}/return`} className="underline-offset-4 hover:underline">{order.returnRequests[0]!.status.split("_").join(" ")}</Link></p>
      )}
      <div className="mt-3 flex flex-wrap gap-4">
        {order.canCancel && <CancelOrderButton orderId={order.id} />}
        {order.canRequestReturn && !order.returnRequests.length && <Link href={`/account/orders/${order.id}/return`} className="font-sans text-xs uppercase tracking-widest text-ink/60 underline-offset-4 hover:text-ink hover:underline">Request a return</Link>}
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <ul className="divide-y divide-ink/10 border-y border-ink/10">
          {order.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 py-4 font-sans text-sm">
              <div>
                <p className="text-ink">{i.productNameSnapshot}</p>
                <p className="text-ink/50">{i.variantSnapshot.label} · Qty {i.quantity}</p>
              </div>
              <p>{formatMoney(i.lineTotalCents)}</p>
            </li>
          ))}
        </ul>

        <div>
          <dl className="space-y-1.5 font-sans text-sm">
            <div className="flex justify-between"><dt className="text-ink/60">Subtotal</dt><dd>{formatMoney(order.subtotalCents)}</dd></div>
            {order.discountTotalCents > 0 && <div className="flex justify-between text-error"><dt>Discount {order.discountCode ? `(${order.discountCode})` : ""}</dt><dd>−{formatMoney(order.discountTotalCents)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink/60">Shipping</dt><dd>{formatMoney(order.shippingTotalCents)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink/60">Tax</dt><dd>{formatMoney(order.taxTotalCents)}</dd></div>
            {order.refundTotalCents > 0 && <div className="flex justify-between"><dt className="text-ink/60">Refunded</dt><dd>−{formatMoney(order.refundTotalCents)}</dd></div>}
            <div className="flex justify-between border-t border-ink/10 pt-2 font-display text-base"><dt>Total</dt><dd>{formatMoney(order.totalCents)}</dd></div>
          </dl>

          {order.shippingAddress && (
            <div className="mt-8">
              <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Shipping address</p>
              <p className="mt-2 font-sans text-sm text-ink/70">
                {order.shippingAddress.firstName} {order.shippingAddress.lastName}<br />
                {order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}<br />
                {order.shippingAddress.city}, {order.shippingAddress.postalCode}<br />
                {order.shippingAddress.country}
              </p>
            </div>
          )}

          <div className="mt-8">
            <p className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Order timeline</p>
            <div className="mt-3"><OrderTimeline status={order.status} fulfillmentStatus={order.fulfillmentStatus} packages={order.packages} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
