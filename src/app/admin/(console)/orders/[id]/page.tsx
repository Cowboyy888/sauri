import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { getOrder } from "@/lib/admin/orders";
import { getOrderFulfillmentDetail } from "@/lib/admin/fulfillment";
import { listReturnsForOrder } from "@/lib/admin/returns";
import { TRANSITIONS } from "@/lib/orders/service";
import { STAGE_TRANSITIONS } from "@/lib/fulfillment/service";
import { dateTimeFull, money, pct, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/status-badge";
import { Thumb } from "@/components/admin/thumb";
import { OrderStatusControl } from "@/components/admin/order-actions";
import { OrderNotes, PartialRefundForm, TrackingForm } from "@/components/admin/order-fulfillment";
import { CreatePackageButton, MarkCompletedButton, PackageCard, PickingList, StageControl } from "@/components/admin/fulfillment-panel";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guard("orders:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const d = await getOrder(db, id);
  if (!d) notFound();
  const { order: o, customer: c, items } = d;
  const [fulfillment, returnRequests] = await Promise.all([getOrderFulfillmentDetail(db, id), listReturnsForOrder(db, id)]);
  const net = o.subtotalCents - o.discountTotalCents - o.refundTotalCents;
  // Once the Phase 5 fulfillment workflow has started for this order, "shipped"/"delivered" can only be
  // reached through packages — offering both would let staff race the package rollup and desync the two.
  const usingFulfillmentWorkflow = o.fulfillmentStatus !== "unfulfilled";
  const next = TRANSITIONS[o.status].filter((s) => s !== "paid" && !(usingFulfillmentWorkflow && (s === "shipped" || s === "delivered")));
  const refundableCents = o.subtotalCents - o.discountTotalCents - o.refundTotalCents;
  const canRefund = g.can("orders:write") && (["paid", "processing", "shipped", "delivered"] as string[]).includes(o.status);
  const canShip = g.can("orders:write") && (["paid", "processing", "shipped", "delivered"] as string[]).includes(o.status) && !usingFulfillmentWorkflow;
  const nextStage = (["paid", "processing"] as string[]).includes(o.status) ? STAGE_TRANSITIONS[o.fulfillmentStatus] ?? null : null;
  const canPack = ["ready_to_ship", "partially_shipped"].includes(o.fulfillmentStatus);
  const Line = ({ l, v, minus, strong, muted }: { l: string; v: number; minus?: boolean; strong?: boolean; muted?: boolean }) => (
    <div className={cn("flex justify-between gap-3 py-1 text-[13px]", strong && "border-t border-line pt-2 font-semibold", muted && "text-muted")}><dt>{l}</dt><dd className="num">{minus && v ? "−" : ""}{money(Math.abs(v))}</dd></div>
  );
  const addr = (a: Record<string, string> | null) => a ? [`${a.firstName ?? a.first ?? ""} ${a.lastName ?? a.last ?? ""}`.trim(), a.line1, a.line2, `${a.city ?? ""} ${a.postalCode ?? a.zip ?? ""}`.trim(), a.country].filter(Boolean) : [];

  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/orders" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Orders</Link>
      <PageHeader title={`Order ${o.orderNumber}`} description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={o.status} kind="order" /><StatusBadge status={o.paymentStatus} label={`Payment: ${titleCase(o.paymentStatus)}`} /><StatusBadge status={o.fulfillmentStatus} label={`Fulfillment: ${titleCase(o.fulfillmentStatus)}`} /><span>Placed {dateTimeFull(o.placedAt)} · {d.channel.name}</span></span>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Items" description="Prices and costs as recorded at the moment of sale." />
            <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Order items</caption>
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Product</th><th className="num px-3 font-medium">Qty</th><th className="num px-3 font-medium">Price</th><th className="num hidden px-3 font-medium sm:table-cell">Cost</th><th className="num hidden px-3 font-medium md:table-cell">Discount</th><th className="num px-3 font-medium">Total</th><th className="num hidden pr-4 font-medium sm:table-cell">Profit</th></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.id} className="border-b border-line-soft last:border-0">
                  <td className="py-2.5 pl-4"><div className="flex items-center gap-2.5"><Thumb src={i.image} alt="" size={40} /><div className="min-w-0">
                    {g.can("products:read") ? <Link href={`/admin/products/${i.productId}`} className="font-medium hover:underline">{i.name}</Link> : <p className="font-medium">{i.name}</p>}
                    <p className="text-xs text-muted">{i.variant} · {i.sku}</p>
                    {i.personalization && (i.personalization.initial || i.personalization.engraving) && <p className="text-xs text-muted">{i.personalization.initial ? `Initial ${i.personalization.initial}` : ""}{i.personalization.engraving ? ` · Engraving “${i.personalization.engraving}”` : ""}</p>}
                  </div></div></td>
                  <td className="num px-3">{i.quantity}</td><td className="num px-3">{money(i.unitPriceCents)}</td><td className="num hidden px-3 text-muted sm:table-cell">{money(i.unitCostCents)}</td>
                  <td className="num hidden px-3 md:table-cell">{i.discountCents ? `−${money(i.discountCents)}` : "—"}</td><td className="num px-3">{money(i.lineTotalCents)}</td>
                  <td className="num hidden pr-4 sm:table-cell">{money(i.lineProfitCents)}</td>
                </tr>))}</tbody></table></div>
          </Card>
          {g.can("inventory:write") && (["paid", "processing"] as string[]).includes(o.status) && (
            <Card>
              <CardHeader title="Fulfillment" description="Processing → picking → packing → ready to ship, then create a shipment (brief §2-8)."
                actions={<div className="flex flex-wrap items-center gap-2"><StageControl orderId={o.id} next={nextStage} />{canPack && <CreatePackageButton orderId={o.id} unpackaged={fulfillment.unpackaged} />}{o.fulfillmentStatus === "delivered" && <MarkCompletedButton orderId={o.id} />}</div>} />
              {["picking", "packing"].includes(o.fulfillmentStatus) && <PickingList picks={fulfillment.picks} />}
              {fulfillment.packages.length > 0 && <CardBody className="grid gap-3">{fulfillment.packages.map((p) => <PackageCard key={p.id} pkg={p} />)}</CardBody>}
            </Card>
          )}
          {g.can("inventory:write") && fulfillment.packages.length > 0 && !(["paid", "processing"] as string[]).includes(o.status) && (
            <Card><CardHeader title="Shipments" description="Multi-package support — the order stays partially shipped until every package ships (brief §40)." /><CardBody className="grid gap-3">
              {fulfillment.packages.map((p) => <PackageCard key={p.id} pkg={p} />)}
            </CardBody></Card>
          )}
          {!g.can("inventory:write") && fulfillment.packages.length > 0 && (
            <Card><CardHeader title="Shipments" /><CardBody className="grid gap-2 text-[13px]">
              {fulfillment.packages.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 border-b border-line-soft py-1.5 last:border-0">
                  <span>Package {p.packageNumber}{p.carrier ? ` · ${p.carrier}` : ""}{p.trackingNumber ? ` · ${p.trackingNumber}` : ""}</span>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </CardBody></Card>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card><CardHeader title="Customer paid" /><CardBody><dl>
              <Line l="Subtotal" v={o.subtotalCents} />{o.discountTotalCents > 0 && <Line l={`Discount${o.discountCode ? ` (${o.discountCode})` : ""}`} v={o.discountTotalCents} minus />}
              <Line l={`Shipping${o.expressShipping ? " (express)" : ""}`} v={o.shippingTotalCents} /><Line l="Tax" v={o.taxTotalCents} /><Line l="Total" v={o.totalCents} strong />
              {o.refundTotalCents > 0 && <Line l="Refunded (merchandise)" v={o.refundTotalCents} minus />}
            </dl></CardBody></Card>
            <Card><CardHeader title="Profit" description="Gross profit = net revenue − COGS" /><CardBody><dl>
              <Line l="Net revenue" v={net} /><Line l="COGS" v={o.costTotalCents} minus /><Line l="Gross profit" v={o.grossProfitCents} strong />
              <div className="flex justify-between py-1 text-[13px]"><dt>Gross margin</dt><dd className="num">{pct(o.grossMargin)}</dd></div>
              <Line l="Payment fee (internal)" v={o.paymentFeeCents} minus muted /><Line l="Carrier cost (internal)" v={o.shippingCostCents} minus muted />
            </dl></CardBody></Card>
          </div>
          <Card>
            <CardHeader title="Inventory movements" description="Stock changes caused by this order." />
            {d.movements.length ? <ul className="divide-y divide-line-soft text-[13px]">{d.movements.map((m) => (
              <li key={m.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2"><StatusBadge status={m.type} /><span className="truncate text-muted">{m.sku} · {m.user} · {dateTimeFull(m.at)}</span><span className="num"><b className={m.quantity < 0 ? "text-neg" : "text-pos"}>{m.quantity > 0 ? "+" : ""}{m.quantity}</b> <span className="text-subtle">{m.before} → {m.after}</span></span></li>
            ))}</ul> : <p className="px-4 py-4 text-[13px] text-muted">{o.status === "pending" ? "Stock is reserved; it will be deducted when payment is confirmed." : "No movements."}</p>}
          </Card>
        </div>
        <div className="grid content-start gap-4">
          {g.can("orders:write") && <Card><CardHeader title="Actions" /><CardBody><OrderStatusControl orderId={o.id} orderNumber={o.orderNumber} next={next} totalLabel={money(o.totalCents)} /></CardBody></Card>}
          <Card><CardHeader title="Customer" /><CardBody className="grid grid-cols-1 gap-1 text-[13px]">
            {g.can("customers:read") ? <Link href={`/admin/customers/${c.id}`} className="font-medium text-accent hover:underline">{c.name}</Link> : <p className="font-medium">{c.name}</p>}
            <p className="text-muted">{c.email}</p>{c.phone && <p className="text-muted">{c.phone}</p>}
            <p className="mt-1 text-xs text-muted">{c.totalOrders} {c.totalOrders === 1 ? "order" : "orders"} · {money(c.totalSpentCents)} lifetime</p>
          </CardBody></Card>
          <Card><CardHeader title="Shipping" /><CardBody className="text-[13px]">{addr(o.shippingAddress).length ? addr(o.shippingAddress).map((l) => <p key={l}>{l}</p>) : <p className="text-muted">No shipping address (in-person sale).</p>}<p className="mt-2 text-xs text-muted">{d.shippingMethodName ?? (o.expressShipping ? "Express" : "Standard")} · charged {money(o.shippingTotalCents)}</p></CardBody></Card>
          <Card><CardHeader title="Payment" /><CardBody className="grid grid-cols-1 gap-2 text-[13px]">
            {d.payments.map((p, i) => <div key={i} className="flex items-center justify-between gap-2"><span>{titleCase(p.provider)}{p.ref ? <span className="block text-xs text-muted">{p.ref}</span> : null}</span><span className="text-right"><StatusBadge status={p.status === "succeeded" ? "paid" : p.status} /><span className="block text-xs text-muted">{money(p.amountCents)}{p.feeCents ? ` · fee ${money(p.feeCents)}` : ""}</span></span></div>)}
            {d.refunds.map((r, i) => <p key={i} className="text-xs text-neg">Refund {money(r.amountCents)} · {r.reason} · {r.restocked ? "restocked" : "not restocked"} · {dateTimeFull(r.at)}</p>)}
          </CardBody></Card>
          {canShip && <Card><CardHeader title="Simple tracking" description={o.trackingNumber ? `${o.carrier ?? "Carrier"} · ${o.trackingNumber}` : "For a single-package order — Phase 5 packages above are the detailed alternative."} /><CardBody>
            <TrackingForm orderId={o.id} trackingNumber={o.trackingNumber} carrier={o.carrier} />
          </CardBody></Card>}
          {returnRequests.length > 0 && (
            <Card><CardHeader title="Returns" /><CardBody className="grid gap-2 text-[13px]">
              {returnRequests.map((r) => (
                <Link key={r.id} href={`/admin/returns/${r.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line-soft px-3 py-2 hover:bg-canvas">
                  <span className="text-muted">{dateTimeFull(r.requestedAt)}</span><StatusBadge status={r.status} />
                </Link>
              ))}
            </CardBody></Card>
          )}
          {canRefund && <Card><CardHeader title="Refund" description={`Refundable: ${money(refundableCents)}`} /><CardBody>
            <PartialRefundForm orderId={o.id} refundableCents={refundableCents} />
          </CardBody></Card>}
          <Card><CardHeader title="Internal Notes" description="Never shown to the customer." /><CardBody>
            <OrderNotes orderId={o.id} notes={o.internalNotes} />
          </CardBody></Card>
          <Card><CardHeader title="Timeline" description="Order, fulfillment, shipping and return events combined (brief §33)." /><CardBody>
            <ol className="relative grid gap-3 border-l border-line pl-4">{fulfillment.timeline.map((e, i) => (
              <li key={i} className="text-[13px]"><span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full bg-accent" aria-hidden /><p className="font-medium">{titleCase(e.status)}<span className="ml-1.5 text-xs font-normal text-subtle">({e.source})</span></p><p className="text-xs text-muted">{dateTimeFull(e.at)}{e.user ? ` · ${e.user}` : ""}</p>{e.note && <p className="text-xs text-muted">{e.note}</p>}</li>
            ))}</ol>
          </CardBody></Card>
        </div>
      </div>
    </div>
  );
}
