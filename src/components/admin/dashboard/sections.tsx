/**
 * Dashboard sections (server components). Each loads its own data through safe(), so one failing query shows an
 * ErrorState for that section only. Everything here is read from Postgres; nothing is hard-coded.
 */
import Link from "next/link";
import type { DbOrTx } from "@/lib/db/client";
import { getMetrics, getSalesBy, getSalesByChannel, getSeries, type Range } from "@/lib/analytics/service";
import { comparisonLabel, pctChange, type ParsedRange } from "@/lib/admin/range";
import { getInventoryValue } from "@/lib/analytics/service";
import { inventorySummary, inventoryValueBy, listSuppliers, lowStock, outOfStock } from "@/lib/admin/inventory";
import { listOrders } from "@/lib/admin/orders";
import { fulfillmentKpis } from "@/lib/admin/fulfillment";
import { returnKpis } from "@/lib/admin/returns";
import { safe } from "@/lib/admin/safe";
import { dateShort, dateTime, int, money, moneyKpi, pct, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "../../ui/card";
import { KPICard } from "../kpi-card";
import { ErrorState, EmptyState } from "../states";
import { StatusBadge } from "../status-badge";
import { Thumb } from "../thumb";
import { BarBreakdown, CategoryBreakdown, ProfitTrend, SalesChart, type Group } from "../charts";
import { AdjustButton, RestockButton } from "../stock-actions";
import { DataTable } from "../data-table";
import { cn } from "../../ui/cn";
import { sql } from "drizzle-orm";
import { productImage, rows as query } from "@/lib/admin/sql";

type Ctx = { db: DbOrTx; r: Range & { previous: Range }; parsed: ParsedRange; fail?: string; canWriteInventory: boolean; canOrders: boolean; canProducts: boolean };
const Err = ({ msg, className }: { msg: string; className?: string }) => <Card className={className}><ErrorState message={msg} /></Card>;

/* §7 KPI cards */
export async function KpiSection({ db, r, parsed, fail }: Ctx) {
  const res = await safe("sales", async () => {
    const [m, p, inv] = await Promise.all([getMetrics(db, r), getMetrics(db, r.previous), getInventoryValue(db)]);
    return { m, p, inv };
  }, fail);
  if (!res.ok) return <Err msg="Unable to load sales data." />;
  const { m, p, inv } = res.data, cmp = comparisonLabel(parsed);
  return (
    <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KPICard label="Total revenue" value={moneyKpi(m.netRevenueCents)} change={pctChange(m.netRevenueCents, p.netRevenueCents)} comparison={cmp} hint="Net of discounts and refunds" />
      <KPICard label="Total orders" value={int(m.orders)} change={pctChange(m.orders, p.orders)} comparison={cmp} />
      <KPICard label="Gross profit" value={moneyKpi(m.grossProfitCents)} change={pctChange(m.grossProfitCents, p.grossProfitCents)} comparison={cmp} hint="Revenue − COGS" />
      <KPICard label="Gross margin" value={pct(m.grossMarginPct)} change={pctChange(m.grossMarginPct, p.grossMarginPct)} comparison={cmp} hint="Gross profit ÷ net revenue" />
      <KPICard label="Average order value" value={money(m.averageOrderValueCents)} change={pctChange(m.averageOrderValueCents, p.averageOrderValueCents)} comparison={cmp} />
      <KPICard label="Units sold" value={int(m.units)} change={pctChange(m.units, p.units)} comparison={cmp} />
      <KPICard label="New customers" value={int(m.newCustomers)} change={pctChange(m.newCustomers, p.newCustomers)} comparison={cmp} hint="First paid order in this period" />
      <KPICard label="Inventory value" value={moneyKpi(inv)} change={null} comparison="" note="Current position, not date-bound" hint="Available stock × cost price" href="/admin/inventory" />
    </section>
  );
}

/* Phase 5 §32: fulfillment queue depth + returns needing action, right on the dashboard. */
export async function FulfillmentKpiSection({ db, fail, canWriteInventory }: Ctx) {
  if (!canWriteInventory) return null;
  const res = await safe("fulfillment", async () => ({ f: await fulfillmentKpis(db), r: await returnKpis(db) }), fail);
  if (!res.ok) return <Err msg="Unable to load fulfillment data." />;
  const { f, r } = res.data;
  const needsAction = r.requested + r.received;
  return (
    <section aria-label="Fulfillment and returns" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KPICard label="To process" value={int(f.processing)} change={null} comparison="" note="Paid orders" href="/admin/fulfillment" />
      <KPICard label="Picking + packing" value={int(f.picking + f.packing)} change={null} comparison="" note="In progress" href="/admin/fulfillment" />
      <KPICard label="Ready to ship" value={int(f.readyToShip + f.partiallyShipped)} change={null} comparison="" note="Awaiting a package" href="/admin/fulfillment" tone={f.readyToShip + f.partiallyShipped > 0 ? "warn" : undefined} />
      <KPICard label="Returns needing action" value={int(needsAction)} change={null} comparison="" note="Requested or received" href="/admin/returns" tone={needsAction > 0 ? "warn" : undefined} />
    </section>
  );
}

/* §8 Sales overview */
export async function SalesOverviewSection({ db, r, fail, rangeText }: Ctx & { rangeText: string }) {
  const res = await safe("chart", async () => {
    const cur = await getSeries(db, r);
    const prev = await getSeries(db, r.previous, { unit: cur.unit });
    return { cur, prev };
  }, fail);
  if (!res.ok) return <Err msg="Unable to load sales data." />;
  return (
    <Card>
      <CardHeader title="Sales overview" description={`Paid orders by ${res.data.cur.unit}, in the store time zone. Dashed line: previous equivalent period.`} />
      <CardBody><SalesChart points={res.data.cur.points} previous={res.data.prev.points} unit={res.data.cur.unit} rangeLabel={rangeText} /></CardBody>
    </Card>
  );
}

/* §9 Revenue breakdown — a financial statement, so revenue and profit can't be confused */
export async function RevenueBreakdownSection({ db, r, fail }: Ctx) {
  const res = await safe("breakdown", () => getMetrics(db, r), fail);
  if (!res.ok) return <Err msg="Unable to load the revenue breakdown." />;
  const m = res.data, base = Math.max(1, m.grossSalesCents);
  const Row = ({ label, value, sub, strong, minus, note }: { label: string; value: number; sub?: boolean; strong?: boolean; minus?: boolean; note?: string }) => (
    <div className={cn("grid grid-cols-[1fr_auto] items-center gap-x-3 py-1.5", strong && "border-t border-line pt-2", sub && "text-muted")}>
      <div className="min-w-0">
        <p className={cn("text-[13px]", strong && "font-semibold")}>{label}{note && <span className="ml-1.5 text-xs text-subtle">{note}</span>}</p>
        {!sub && <div className="mt-1 h-1.5 rounded-full bg-line-soft"><div className={cn("h-full rounded-full", minus ? "bg-[#d9c7a6]" : strong ? "bg-accent" : "bg-[#9fb7ae]")} style={{ width: `${Math.min(100, (Math.abs(value) / base) * 100)}%` }} /></div>}
      </div>
      <p className={cn("num text-[13px]", strong && "font-semibold", minus && "text-muted")}>{minus && value ? "−" : ""}{money(Math.abs(value))}</p>
    </div>
  );
  return (
    <Card>
      <CardHeader title="Revenue breakdown" description="From gross sales to gross profit, for the selected period." />
      <CardBody className="grid grid-cols-1 gap-0.5">
        <Row label="Gross sales" value={m.grossSalesCents} />
        <Row label="Discounts" value={m.discountCents} minus />
        <Row label="Refunds" value={m.refundCents} minus />
        <Row label="Net revenue" value={m.netRevenueCents} strong />
        <Row label="Cost of goods sold (COGS)" value={m.cogsCents} minus />
        <Row label="Gross profit" value={m.grossProfitCents} strong note={`${pct(m.grossMarginPct)} margin`} />
        <div className="mt-3 rounded-md bg-canvas px-3 py-2">
          <p className="mb-1 text-xs font-medium text-muted">Collected for others, not revenue</p>
          <Row label="Shipping charged to customers" value={m.shippingChargedCents} sub />
          <Row label="Taxes collected" value={m.taxCents} sub />
        </div>
        <p className="mt-2 text-xs text-subtle">Payment fees ({money(m.paymentFeeCents)}) and carrier costs ({money(m.shippingCostCents)}) are not part of gross profit; after them, contribution profit is {money(m.contributionProfitCents)}.</p>
      </CardBody>
    </Card>
  );
}

/* §10 Profit analytics */
export async function ProfitSection({ db, r, fail }: Ctx) {
  const res = await safe("profit", async () => ({ m: await getMetrics(db, r), s: await getSeries(db, r) }), fail);
  if (!res.ok) return <Err msg="Unable to load profit data." />;
  const { m, s } = res.data;
  const Stat = ({ l, v }: { l: string; v: string }) => <div><p className="text-xs text-muted">{l}</p><p className="mt-0.5 text-[17px] font-semibold">{v}</p></div>;
  return (
    <Card>
      <CardHeader title="Profit" description={<>Gross profit = Revenue − COGS · Gross margin = Gross profit ÷ Net revenue × 100</>} />
      <CardBody className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat l="Revenue" v={moneyKpi(m.netRevenueCents)} /><Stat l="COGS" v={moneyKpi(m.cogsCents)} /><Stat l="Gross profit" v={moneyKpi(m.grossProfitCents)} /><Stat l="Gross margin" v={pct(m.grossMarginPct)} /></div>
        <ProfitTrend points={s.points} unit={s.unit} />
      </CardBody>
    </Card>
  );
}

/* §11 Top products */
const TOP_SORTS = { units: ["units", "Units sold"], revenue: ["netRevenueCents", "Revenue"], profit: ["grossProfitCents", "Profit"], margin: ["grossMarginPct", "Margin"] } as const;
export async function TopProductsSection({ db, r, fail, sort, baseParams }: Ctx & { sort: string; baseParams: Record<string, string> }) {
  const res = await safe("top", async () => {
    const prods = await getSalesBy(db, r, "product");
    // Per product: available stock, first image, and its best-selling SKU in the period.
    const extra = await query<{ product_id: string; available: string; image: string | null; top_sku: string | null }>(db, sql`
      select vs.product_id, sum(vs.available_stock) as available, ${productImage("vs.product_id")} as image,
             (select i.sku_snapshot from order_items i join orders o on o.id = i.order_id
              where i.product_id = vs.product_id and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()} and o.refund_total_cents = 0
              group by i.sku_snapshot order by sum(i.quantity) desc limit 1) as top_sku
      from variant_stock vs group by vs.product_id`);
    return { prods, extra };
  }, fail);
  if (!res.ok) return <Err msg="Unable to load top products." />;
  const key = (Object.keys(TOP_SORTS).includes(sort) ? sort : "revenue") as keyof typeof TOP_SORTS;
  const field = TOP_SORTS[key][0];
  const stock = new Map(res.data.extra.map((s) => [s.product_id, { a: Number(s.available), image: s.image, sku: s.top_sku }]));
  const rows = [...res.data.prods].sort((a, b) => b[field] - a[field]).slice(0, 10);
  const q = (s: string) => `?${new URLSearchParams({ ...baseParams, top: s })}#top-products`;
  return (
    <Card id="top-products">
      <CardHeader title="Top selling products" description="Line-level sales in the period (fully refunded orders excluded)."
        actions={<div role="group" aria-label="Sort by" className="inline-flex h-8 rounded-md border border-line bg-surface p-0.5 text-[12.5px]">
          {Object.entries(TOP_SORTS).map(([k, [, l]]) => <Link key={k} href={q(k)} scroll={false} aria-current={k === key ? "true" : undefined} className={cn("grid place-items-center rounded px-2.5 font-medium text-muted hover:text-fg", k === key && "bg-fg text-white hover:text-white")}>{l}</Link>)}
        </div>} />
      <DataTable caption="Top selling products" rows={rows} rowKey={(x) => x.key} basePath="" params={{}} dense
        empty={<EmptyState title="No sales in this period" description="Try a longer date range." />}
        columns={[
          { key: "p", header: "Product", cell: (x) => (
            <div className="flex items-center gap-2.5"><Thumb src={stock.get(x.key)?.image} alt="" size={36} />
              <div className="min-w-0"><Link href={`/admin/products/${x.key}?tab=analytics`} className="block truncate font-medium hover:underline">{x.label}</Link><span className="text-xs text-muted">{stock.get(x.key)?.sku ?? ""}</span></div></div>) },
          { key: "u", header: "Units sold", align: "right", cell: (x) => int(x.units) },
          { key: "r", header: "Revenue", align: "right", cell: (x) => money(x.netRevenueCents) },
          { key: "g", header: "Profit", align: "right", cell: (x) => money(x.grossProfitCents), hideBelow: "sm" },
          { key: "m", header: "Margin", align: "right", cell: (x) => pct(x.grossMarginPct), hideBelow: "md" },
          { key: "s", header: "Stock", align: "right", cell: (x) => { const a = stock.get(x.key)?.a ?? 0; return <span className={cn(a <= 0 && "text-neg")}>{int(a)}</span>; }, hideBelow: "sm" },
        ]} />
    </Card>
  );
}

/* §12 Category + §13 Channel */
export async function CategorySection({ db, r, fail }: Ctx) {
  const res = await safe("category", async () => {
    const cats = await getSalesBy(db, r, "category");
    const per = await Promise.all(cats.map(async (c) => [c.key, (await getSalesBy(db, r, "product", { categorySlug: c.key })).slice(0, 8)] as const));
    return { cats, per: Object.fromEntries(per) as Record<string, Group[]> };
  }, fail);
  if (!res.ok) return <Err msg="Unable to load sales by category." />;
  return <Card><CardHeader title="Sales by category" description="Click a category to see its products." /><CardBody><CategoryBreakdown groups={res.data.cats} productsByCategory={res.data.per} /></CardBody></Card>;
}

export async function ChannelSection({ db, r, fail }: Ctx) {
  const res = await safe("channel", () => getSalesByChannel(db, r), fail);
  if (!res.ok) return <Err msg="Unable to load sales by channel." />;
  const g = res.data;
  return (
    <Card>
      <CardHeader title="Sales by channel" description="Revenue, orders and profit by where the sale happened." actions={<Link href="/admin/analytics/channels" className="text-xs font-medium text-accent hover:underline">Channel analytics</Link>} />
      <CardBody>
        <BarBreakdown groups={g} ariaLabel="Revenue by channel" />
        {g.length > 0 && <div className="mt-2 relative overflow-x-auto"><table className="w-full text-[12.5px]"><caption className="sr-only">Sales by channel</caption>
          <thead><tr className="text-left text-xs text-muted"><th className="py-1.5 font-medium">Channel</th><th className="num font-medium">Revenue</th><th className="num font-medium">Orders</th><th className="num font-medium">Profit</th><th className="num font-medium">Share</th></tr></thead>
          <tbody>{g.map((x) => <tr key={x.key} className="border-t border-line-soft"><td className="py-1.5">{x.label}</td><td className="num">{money(x.netRevenueCents)}</td><td className="num">{int(x.orders)}</td><td className="num">{money(x.grossProfitCents)}</td><td className="num">{pct(x.shareOfRevenuePct)}</td></tr>)}</tbody>
        </table></div>}
      </CardBody>
    </Card>
  );
}

/* §14 Recent orders */
export async function RecentOrdersSection({ db, fail, canOrders }: Ctx) {
  const res = await safe("orders", () => listOrders(db, { page: 1, pageSize: 8, sort: "date" }), fail);
  if (!res.ok) return <Err msg="Unable to load recent orders." />;
  return (
    <Card>
      <CardHeader title="Recent orders" actions={canOrders ? <Link href="/admin/orders" className="text-xs font-medium text-accent hover:underline">All orders</Link> : undefined} />
      <DataTable caption="Recent orders" rows={res.data.rows} rowKey={(o) => o.id} basePath="" params={{}} dense empty={<EmptyState title="No orders yet" />}
        columns={[
          { key: "n", header: "Order", cell: (o) => canOrders ? <Link href={`/admin/orders/${o.id}`} className="font-medium text-accent hover:underline">{o.orderNumber}</Link> : <span className="font-medium">{o.orderNumber}</span> },
          { key: "c", header: "Customer", cell: (o) => <span className="block max-w-[160px] truncate">{o.customer}</span> },
          { key: "d", header: "Date", cell: (o) => <span className="whitespace-nowrap text-muted" title={dateTime(o.placedAt)}>{relTime(o.placedAt)}</span>, hideBelow: "sm" },
          { key: "ch", header: "Channel", cell: (o) => o.channel, hideBelow: "lg" },
          { key: "i", header: "Items", align: "right", cell: (o) => o.items, hideBelow: "lg" },
          { key: "p", header: "Payment", cell: (o) => <StatusBadge status={o.paymentStatus} />, hideBelow: "md" },
          { key: "s", header: "Status", cell: (o) => <StatusBadge status={o.status} kind="order" /> },
          { key: "t", header: "Total", align: "right", cell: (o) => money(o.totalCents) },
          { key: "g", header: "Profit", align: "right", cell: (o) => <span className={cn(o.grossProfitCents < 0 && "text-neg")}>{money(o.grossProfitCents)}</span>, hideBelow: "md" },
          { key: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (o) => canOrders ? <Link href={`/admin/orders/${o.id}`} className="text-xs font-medium text-accent hover:underline">View</Link> : null, hideBelow: "sm" },
        ]} />
    </Card>
  );
}

/* §15 Inventory summary + §18 value by category */
export async function InventorySummarySection({ db, fail }: Ctx) {
  const res = await safe("inventory", async () => ({ s: await inventorySummary(db), byCat: await inventoryValueBy(db, "category") }), fail);
  if (!res.ok) return <Err msg="Unable to load inventory data." />;
  const { s, byCat } = res.data;
  const Tile = ({ l, v, tone, href }: { l: string; v: string; tone?: string; href?: string }) => {
    const inner = <><p className="text-xs text-muted">{l}</p><p className={cn("mt-0.5 text-[18px] font-semibold", tone)}>{v}</p></>;
    return href ? <Link href={href} className="rounded-md border border-line-soft p-3 hover:border-line">{inner}</Link> : <div className="rounded-md border border-line-soft p-3">{inner}</div>;
  };
  return (
    <Card>
      <CardHeader title="Inventory" description="Current position. Not affected by the date range." actions={<Link href="/admin/inventory" className="text-xs font-medium text-accent hover:underline">Open inventory</Link>} />
      <CardBody className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile l="Total products" v={int(s.totalProducts)} /><Tile l="Total units" v={int(s.totalUnits)} /><Tile l="Inventory value" v={moneyKpi(s.inventoryValueCents)} />
          <Tile l="Low stock" v={int(s.lowStock)} tone={s.lowStock ? "text-warn" : undefined} href="/admin/inventory?status=LOW_STOCK" />
          <Tile l="Out of stock" v={int(s.outOfStock)} tone={s.outOfStock ? "text-neg" : undefined} href="/admin/inventory?status=OUT_OF_STOCK" />
          <Tile l="Reserved units" v={int(s.reservedUnits)} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Inventory value by category (available × cost)</p>
          <ul className="grid grid-cols-1 gap-1.5">{byCat.map((c) => (
            <li key={c.label} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-[12.5px]">
              <span className="truncate">{c.label}</span><span className="h-1.5 rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${c.sharePct}%` }} /></span><span className="num">{moneyKpi(c.valueCents)}</span>
            </li>))}</ul>
        </div>
      </CardBody>
    </Card>
  );
}

/* §16 Low stock (most urgent first) and §17 Out of stock */
export async function LowStockSection({ db, fail, canWriteInventory }: Ctx) {
  const res = await safe("low", async () => ({ rows: await lowStock(db, 8), suppliers: (await listSuppliers(db)).map((x) => x.name) }), fail);
  if (!res.ok) return <Err msg="Unable to load low-stock items." />;
  const { rows, suppliers } = res.data;
  return (
    <Card className={cn(rows.length && "border-[#e8d9bb]")}>
      <CardHeader title={<span className="flex items-center gap-2">Low stock {rows.length > 0 && <StatusBadge status="LOW_STOCK" label={String(rows.length >= 8 ? "8+" : rows.length)} />}</span>} description="At or below the reorder level. Most urgent first. Days remaining is an estimate from the last 30 days of sales."
        actions={<Link href="/admin/inventory?status=LOW_STOCK" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
      <DataTable caption="Low stock" rows={rows} rowKey={(x) => x.variantId} basePath="" params={{}} dense empty={<EmptyState title="Nothing is running low" description="Every variant is above its reorder level." />}
        columns={[
          { key: "p", header: "Product", cell: (x) => <div className="flex items-center gap-2"><Thumb src={x.image} alt="" size={32} /><div className="min-w-0 max-w-[150px] sm:max-w-none"><p className="truncate font-medium">{x.productName}</p><p className="truncate text-xs text-muted">{x.label}<span className="hidden sm:inline"> · {x.sku}</span></p></div></div> },
          { key: "a", header: "Stock", align: "right", cell: (x) => <b className="text-warn">{x.availableStock}</b> },
          { key: "r", header: "Reorder at", align: "right", cell: (x) => x.reorderLevel, hideBelow: "md" },
          { key: "d", header: <span title="Estimate from the last 30 days of sales">Days left*</span>, align: "right", hideBelow: "sm", cell: (x) => x.estimatedDaysRemaining == null ? <span className="text-subtle">no recent sales</span> : <span className={cn(x.estimatedDaysRemaining <= 7 && "font-semibold text-neg")}>≈ {x.estimatedDaysRemaining}</span> },
          { key: "act", header: <span className="sr-only">Action</span>, align: "right", cell: (x) => canWriteInventory ? <span className="inline-flex gap-1"><RestockButton target={x} suppliers={suppliers} /><span className="hidden 2xl:inline"><AdjustButton target={x} /></span></span> : null },
        ]} />
    </Card>
  );
}

export async function OutOfStockSection({ db, fail, canWriteInventory }: Ctx) {
  const res = await safe("out", async () => ({ rows: await outOfStock(db, 8), suppliers: (await listSuppliers(db)).map((x) => x.name) }), fail);
  if (!res.ok) return <Err msg="Unable to load out-of-stock items." />;
  const { rows, suppliers } = res.data;
  return (
    <Card className={cn(rows.length && "border-[#ecc9c2]")}>
      <CardHeader title={<span className="flex items-center gap-2">Out of stock {rows.length > 0 && <StatusBadge status="OUT_OF_STOCK" label={String(rows.length >= 8 ? "8+" : rows.length)} />}</span>} description="Nothing available to sell. Best sellers first."
        actions={<Link href="/admin/inventory?status=OUT_OF_STOCK" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
      <DataTable caption="Out of stock" rows={rows} rowKey={(x) => x.variantId} basePath="" params={{}} dense empty={<EmptyState title="Nothing is out of stock" />}
        columns={[
          { key: "p", header: "Product", cell: (x) => <div className="flex items-center gap-2"><Thumb src={x.image} alt="" size={32} /><div className="min-w-0 max-w-[150px] sm:max-w-none"><p className="truncate font-medium">{x.productName}</p><p className="truncate text-xs text-muted">{x.label}<span className="hidden sm:inline"> · {x.sku}</span></p></div></div> },
          { key: "l", header: "Last sold", cell: (x) => x.lastSoldAt ? <span title={dateTime(x.lastSoldAt)}>{dateShort(x.lastSoldAt)}</span> : <span className="text-subtle">never</span>, hideBelow: "sm" },
          { key: "s", header: "Sold (30d)", align: "right", cell: (x) => int(x.sold30), hideBelow: "sm" },
          { key: "act", header: <span className="sr-only">Action</span>, align: "right", cell: (x) => canWriteInventory ? <RestockButton target={x} suppliers={suppliers} variant="primary" /> : null },
        ]} />
    </Card>
  );
}
