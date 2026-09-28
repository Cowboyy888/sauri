import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { getCustomer } from "@/lib/admin/customers";
import { listOrders } from "@/lib/admin/orders";
import { dateShort, dateTime, int, money, moneyKpi } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { Thumb } from "@/components/admin/thumb";
import { EmptyState } from "@/components/admin/states";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guard("customers:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const c = await getCustomer(db, id);
  if (!c) notFound();
  const orders = g.can("orders:read") ? await listOrders(db, { customerId: id, page: 1, pageSize: 50, sort: "date" }) : null;
  const maxUnits = Math.max(1, ...c.favoriteCategories.map((f) => f.units));
  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Customers</Link>
      <PageHeader title={c.name} description={`${c.email}${c.phone ? ` · ${c.phone}` : ""} · customer since ${dateShort(c.customerSince)}${c.registered ? " · has an account" : " · guest checkout"}`} />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Customer figures">
        <KPICard label="Total spent" value={moneyKpi(c.totalSpentCents)} change={null} comparison="" note="Net of discounts and refunds" />
        <KPICard label="Total orders" value={int(c.totalOrders)} change={null} comparison="" note={c.lastOrderAt ? `Last ${dateShort(c.lastOrderAt)}` : "No paid orders"} />
        <KPICard label="Average order value" value={money(c.averageOrderValueCents)} change={null} comparison="" note="Total spent ÷ orders" />
        <KPICard label="Customer lifetime value" value={moneyKpi(c.lifetimeValueCents)} change={null} comparison="" note={`${money(c.grossProfitCents)} gross profit`} />
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Order history" />
          {orders ? (orders.rows.length ? <ul className="divide-y divide-line-soft text-[13px]">{orders.rows.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"><span><Link href={`/admin/orders/${o.id}`} className="font-medium text-accent hover:underline">{o.orderNumber}</Link> <span className="text-muted">· {dateTime(o.placedAt)} · {o.channel} · {o.items} {o.items === 1 ? "item" : "items"}</span></span><span className="flex items-center gap-2"><span className="num">{money(o.totalCents)}</span><StatusBadge status={o.status} kind="order" /></span></li>
          ))}</ul> : <EmptyState title="No orders" />) : <p className="px-4 py-4 text-[13px] text-muted">Your role can’t view orders.</p>}
        </Card>
        <div className="grid content-start gap-4">
          <Card><CardHeader title="Favorite categories" description="By units bought" /><CardBody>
            {c.favoriteCategories.length ? <ul className="grid grid-cols-1 gap-2">{c.favoriteCategories.map((f) => (
              <li key={f.category} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-[13px]"><span>{f.category}</span><span className="h-1.5 rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${(f.units / maxUnits) * 100}%` }} /></span><span className="num text-muted">{f.units} · {money(f.revenueCents)}</span></li>
            ))}</ul> : <p className="text-[13px] text-muted">No purchases yet.</p>}
          </CardBody></Card>
          <Card><CardHeader title="Recently purchased" /><CardBody>
            {c.recentProducts.length ? <ul className="grid grid-cols-1 gap-2">{c.recentProducts.map((p) => (
              <li key={p.productId} className="flex items-center gap-2.5 text-[13px]"><Thumb src={p.image} alt="" size={34} /><span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="text-xs text-muted">{p.sku} · {dateShort(p.at)}</span></span></li>
            ))}</ul> : <p className="text-[13px] text-muted">Nothing yet.</p>}
          </CardBody></Card>
          <Card><CardHeader title="Wishlist" /><CardBody>
            {c.wishlist.length ? <ul className="grid grid-cols-1 gap-2">{c.wishlist.map((w) => <li key={w.productId} className="flex items-center gap-2.5 text-[13px]"><Thumb src={w.image} alt="" size={30} />{w.name}</li>)}</ul> : <p className="text-[13px] text-muted">{c.registered ? "Wishlist is empty." : "Guest customers don’t have a saved wishlist."}</p>}
          </CardBody></Card>
          <Card><CardHeader title="Addresses" /><CardBody className="grid grid-cols-1 gap-3 text-[13px]">
            {c.addresses.length ? c.addresses.map((a, i) => <div key={i}><p className="text-xs text-muted">{a.type}{a.isDefault ? " · default" : ""}</p><p className="font-medium">{a.name}</p>{a.lines.map((l) => <p key={l}>{l}</p>)}</div>) : <p className="text-muted">No saved address.</p>}
          </CardBody></Card>
        </div>
      </div>
    </div>
  );
}
