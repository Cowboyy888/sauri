import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { getCustomerOrders } from "@/lib/storefront/account";
import { formatMoney } from "@/lib/money";
import { dateShort } from "@/lib/format";

export const metadata: Metadata = { title: "Order History" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { pending: "Payment pending", paid: "Paid", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded" };

export default async function OrdersPage() {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) redirect("/account?next=/account/orders");
  const orders = await getCustomerOrders(db, customer.id);

  return (
    <div>
      <h1 className="font-display text-3xl">Order History</h1>
      {!orders.length ? (
        <div className="py-16 text-center">
          <p className="font-display text-lg text-ink/70">You haven&rsquo;t placed an order yet.</p>
          <Link href="/collections/best-sellers" className="mt-5 inline-block border border-ink px-6 py-3 font-sans text-xs uppercase tracking-widest">Start shopping</Link>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse font-sans text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-widest text-ink/40">
                <th className="py-3 font-medium">Order</th>
                <th className="py-3 font-medium">Date</th>
                <th className="py-3 font-medium">Items</th>
                <th className="py-3 font-medium">Status</th>
                <th className="py-3 text-right font-medium">Total</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-ink/10">
                  <td className="py-4">{o.orderNumber}</td>
                  <td className="py-4 text-ink/60">{dateShort(o.placedAt)}</td>
                  <td className="py-4 text-ink/60">{o.itemCount}</td>
                  <td className="py-4 text-ink/60">{STATUS_LABEL[o.status] ?? o.status}</td>
                  <td className="py-4 text-right">{formatMoney(o.totalCents)}</td>
                  <td className="py-4 text-right"><Link href={`/account/orders/${o.id}`} className="text-xs uppercase tracking-widest text-ink underline-offset-4 hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
