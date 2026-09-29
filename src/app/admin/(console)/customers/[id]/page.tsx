import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { getCustomer } from "@/lib/admin/customers";
import { listTags } from "@/lib/crm/customer-management";
import { SEGMENT_LABELS } from "@/lib/crm/segments";
import { getLoyaltySettings } from "@/lib/loyalty/service";
import { dateShort, dateTimeFull, int, money, moneyKpi, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { Thumb } from "@/components/admin/thumb";
import { EmptyState } from "@/components/admin/states";
import { AdjustPointsForm, AnonymizeCustomerButton, CustomerCommunications, CustomerNotes, CustomerTags, MergeCustomerButton } from "@/components/admin/customer-panels";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guard("customers:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const [c, allTags, loyaltyCfg] = await Promise.all([getCustomer(db, id), listTags(db), getLoyaltySettings(db)]);
  if (!c) notFound();
  const maxUnits = Math.max(1, ...c.favoriteCategories.map((f) => f.units));

  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Customers</Link>
      <PageHeader
        title={c.name}
        description={<span className="inline-flex flex-wrap items-center gap-2">
          <span>{c.email}{c.phone ? ` · ${c.phone}` : ""} · customer since {dateShort(c.customerSince)}{c.registered ? " · has an account" : " · guest checkout"}</span>
          {c.anonymized && <StatusBadge status="cancelled" label="Anonymized" />}
        </span>}
        actions={g.can("customers:write") && !c.anonymized && <div className="flex items-center gap-2"><MergeCustomerButton customerId={id} /><AnonymizeCustomerButton customerId={id} /></div>}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {c.segments.map((seg) => <span key={seg} className="inline-flex h-[22px] items-center whitespace-nowrap rounded bg-accent-soft px-2 text-xs font-medium text-accent">{SEGMENT_LABELS[seg].label}</span>)}
          <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded bg-[#e8eef7] px-2 text-xs font-medium text-info">RFM: {c.rfm.recencyLabel}</span>
          <CustomerTags customerId={id} current={c.tags} allTags={allTags} />
        </div>
      </PageHeader>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Financial summary">
        <KPICard label="Total orders" value={int(c.totalOrders)} change={null} comparison="" note={c.firstOrderAt ? `First ${dateShort(c.firstOrderAt)}` : "No paid orders"} />
        <KPICard label="Lifetime revenue" value={moneyKpi(c.grossRevenueCents)} change={null} comparison="" note="Before refunds" />
        <KPICard label="Total refunded" value={moneyKpi(c.totalRefundedCents)} change={null} comparison="" tone={c.totalRefundedCents > 0 ? "warn" : undefined} />
        <KPICard label="Net spend" value={moneyKpi(c.netSpendCents)} change={null} comparison="" note="Revenue − refunds — this is customer lifetime value" />
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="More financial summary">
        <KPICard label="Average order value" value={money(c.averageOrderValueCents)} change={null} comparison="" />
        <KPICard label="Gross profit" value={money(c.grossProfitCents)} change={null} comparison="" />
        <KPICard label="Last purchase" value={c.lastOrderAt ? dateShort(c.lastOrderAt) : "—"} change={null} comparison="" />
        <KPICard label="First purchase" value={c.firstOrderAt ? dateShort(c.firstOrderAt) : "—"} change={null} comparison="" />
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Attribution and behavior">
        <KPICard label="First source" value={c.firstTouchSource ? titleCase(c.firstTouchSource) : "Unknown"} change={null} comparison="" note={c.firstOrderAt ? `First order ${dateShort(c.firstOrderAt)}` : "No order yet"} />
        <KPICard label="Last source" value={c.lastTouchSource ? titleCase(c.lastTouchSource) : "Unknown"} change={null} comparison="" note={c.lastOrderAt ? `Last order ${dateShort(c.lastOrderAt)}` : "No order yet"} />
        <KPICard label="Items per order" value={String(c.itemsPerOrder)} change={null} comparison="" />
        <KPICard label="Loyalty points" value={int(c.loyalty.pointsBalance)} change={null} comparison="" note={c.loyalty.tier ? `${c.loyalty.tier.name} tier` : "No tier yet"} href="/admin/loyalty" />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Order history" />
            {c.orders.length ? (
              <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Orders</caption>
                <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Order</th><th className="px-3 font-medium">Date</th><th className="num px-3 font-medium">Items</th><th className="px-3 font-medium">Payment</th><th className="px-3 font-medium">Fulfillment</th><th className="px-3 font-medium">Return</th><th className="num px-3 pr-4 font-medium">Total</th></tr></thead>
                <tbody>{c.orders.map((o) => (
                  <tr key={o.id} className="border-b border-line-soft last:border-0">
                    <td className="py-2.5 pl-4"><Link href={`/admin/orders/${o.id}`} className="font-medium text-accent hover:underline">{o.orderNumber}</Link></td>
                    <td className="px-3 text-muted">{dateShort(o.placedAt)}</td>
                    <td className="num px-3">{o.items}</td>
                    <td className="px-3"><StatusBadge status={o.paymentStatus} /></td>
                    <td className="px-3"><StatusBadge status={o.fulfillmentStatus} /></td>
                    <td className="px-3">{o.returnStatus ? <StatusBadge status={o.returnStatus} /> : <span className="text-subtle">—</span>}</td>
                    <td className="num px-3 pr-4">{money(o.totalCents)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <EmptyState title="No orders" />}
          </Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card><CardHeader title="Favorite categories" description="By units bought" /><CardBody>
              {c.favoriteCategories.length ? <ul className="grid grid-cols-1 gap-2">{c.favoriteCategories.map((f) => (
                <li key={f.category} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-[13px]"><span>{f.category}</span><span className="h-1.5 rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${(f.units / maxUnits) * 100}%` }} /></span><span className="num text-muted">{f.units} · {money(f.revenueCents)}</span></li>
              ))}</ul> : <p className="text-[13px] text-muted">No purchases yet.</p>}
            </CardBody></Card>
            <Card><CardHeader title="Favorite materials & sizes" /><CardBody className="grid gap-3 text-[13px]">
              <div><p className="mb-1 text-xs text-muted">Materials</p>{c.favoriteMaterials.length ? c.favoriteMaterials.map((m) => <span key={m.value} className="mr-2 inline-block">{m.value.toUpperCase()} ({m.units})</span>) : <span className="text-muted">—</span>}</div>
              <div><p className="mb-1 text-xs text-muted">Sizes</p>{c.favoriteSizes.length ? c.favoriteSizes.map((sVal) => <span key={sVal.value} className="mr-2 inline-block">{sVal.value} ({sVal.units})</span>) : <span className="text-muted">—</span>}</div>
            </CardBody></Card>
          </div>
          <Card><CardHeader title="Recently purchased" /><CardBody>
            {c.recentProducts.length ? <ul className="grid grid-cols-1 gap-2">{c.recentProducts.map((p) => (
              <li key={p.productId} className="flex items-center gap-2.5 text-[13px]"><Thumb src={p.image} alt="" size={34} /><span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="text-xs text-muted">{p.sku} · {dateShort(p.at)}</span></span></li>
            ))}</ul> : <p className="text-[13px] text-muted">Nothing yet.</p>}
          </CardBody></Card>
          {g.can("customers:write") && <Card><CardHeader title="Communication history" description="Manually logged — never sent automatically." /><CardBody>
            <CustomerCommunications customerId={id} items={c.communications} />
          </CardBody></Card>}
          {g.can("customers:write") && <Card><CardHeader title="Internal notes" description="Never shown to the customer." /><CardBody>
            <CustomerNotes customerId={id} notes={c.notes} />
          </CardBody></Card>}
        </div>
        <div className="grid content-start gap-4">
          {loyaltyCfg.enabled && g.can("loyalty:write") && <Card><CardHeader title="Loyalty" description={c.loyalty.tier ? `${c.loyalty.tier.name} tier${c.loyalty.nextTier ? ` · ${money(c.loyalty.centsToNextTier)} to ${c.loyalty.nextTier.name}` : ""}` : undefined} /><CardBody>
            <AdjustPointsForm customerId={id} />
          </CardBody></Card>}
          <Card><CardHeader title="RFM" description="Recency / Frequency / Monetary" /><CardBody className="grid grid-cols-3 gap-2 text-center text-[13px]">
            <div><p className="text-lg font-semibold">{c.rfm.recencyDays ?? "—"}</p><p className="text-xs text-muted">days since last order</p></div>
            <div><p className="text-lg font-semibold">{c.rfm.frequency}</p><p className="text-xs text-muted">orders</p></div>
            <div><p className="text-lg font-semibold">{money(c.rfm.monetaryCents)}</p><p className="text-xs text-muted">net spend</p></div>
          </CardBody></Card>
          <Card><CardHeader title="Wishlist" /><CardBody>
            {c.wishlist.length ? <ul className="grid grid-cols-1 gap-2">{c.wishlist.map((w) => <li key={w.productId} className="flex items-center gap-2.5 text-[13px]"><Thumb src={w.image} alt="" size={30} />{w.name}</li>)}</ul> : <p className="text-[13px] text-muted">{c.registered ? "Wishlist is empty." : "Guest customers don’t have a saved wishlist."}</p>}
          </CardBody></Card>
          <Card><CardHeader title="Addresses" /><CardBody className="grid grid-cols-1 gap-3 text-[13px]">
            {c.addresses.length ? c.addresses.map((a, i) => <div key={i}><p className="text-xs text-muted">{a.type}{a.isDefault ? " · default" : ""}</p><p className="font-medium">{a.name}</p>{a.lines.map((l) => <p key={l}>{l}</p>)}</div>) : <p className="text-muted">No saved address.</p>}
          </CardBody></Card>
          <Card><CardHeader title="Consent history" /><CardBody className="grid gap-1.5 text-[13px]">
            {c.consents.length ? c.consents.map((co, i) => <p key={i} className="text-xs text-muted">{titleCase(co.type)}: <b className="font-medium text-fg">{co.consent ? "granted" : "withdrawn"}</b> · {co.source} · {dateTimeFull(co.createdAt)}</p>) : <p className="text-muted">No consent changes recorded.</p>}
            <p className="mt-1 text-xs text-muted">Current: email {c.marketingOptIn ? "opted in" : "opted out"} · SMS {c.smsConsent ? "opted in" : "opted out"}</p>
          </CardBody></Card>
        </div>
      </div>
    </div>
  );
}
