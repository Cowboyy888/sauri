import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { getCustomerOrder } from "@/lib/storefront/account";
import { getReturnEligibleItems } from "@/lib/returns/service";
import { dateTimeFull } from "@/lib/format";
import { ReturnRequestForm } from "@/components/storefront/account/return-request-form";

export const metadata: Metadata = { title: "Request a Return" };
export const dynamic = "force-dynamic";

export default async function RequestReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) redirect(`/account?next=/account/orders/${id}/return`);
  const order = await getCustomerOrder(db, customer.id, id);
  if (!order) notFound();

  if (order.returnRequests.length) {
    const latest = order.returnRequests[0]!;
    return (
      <div>
        <Link href={`/account/orders/${id}`} className="font-sans text-xs uppercase tracking-widest text-ink/50 hover:text-ink">← Order {order.orderNumber}</Link>
        <h1 className="mt-4 font-display text-3xl">Return already requested</h1>
        <p className="mt-3 max-w-md font-sans text-sm text-ink/60">You requested a return for this order on {dateTimeFull(latest.requestedAt)}. Current status: <span className="text-ink">{latest.status.split("_").join(" ")}</span>.</p>
      </div>
    );
  }
  if (!order.canRequestReturn) {
    return (
      <div>
        <Link href={`/account/orders/${id}`} className="font-sans text-xs uppercase tracking-widest text-ink/50 hover:text-ink">← Order {order.orderNumber}</Link>
        <h1 className="mt-4 font-display text-3xl">This order isn&rsquo;t eligible for a return</h1>
        <p className="mt-3 max-w-md font-sans text-sm text-ink/60">This is usually because the order hasn&rsquo;t been delivered yet, or the return window has closed. See our <Link href="/pages/returns" className="underline-offset-4 hover:underline">returns policy</Link> for details.</p>
      </div>
    );
  }

  const items = await getReturnEligibleItems(db, id);
  return (
    <div>
      <Link href={`/account/orders/${id}`} className="font-sans text-xs uppercase tracking-widest text-ink/50 hover:text-ink">← Order {order.orderNumber}</Link>
      <h1 className="mt-4 font-display text-3xl">Request a Return</h1>
      <p className="mt-2 max-w-md font-sans text-sm text-ink/60">Choose the item(s) you&rsquo;d like to return. We&rsquo;ll email you once we&rsquo;ve reviewed your request.</p>
      <div className="mt-8 max-w-xl"><ReturnRequestForm orderId={id} items={items} /></div>
    </div>
  );
}
