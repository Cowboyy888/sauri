import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { getProduct, getProductAnalytics, type VariantRow } from "@/lib/admin/products";
import { listSuppliers } from "@/lib/admin/inventory";
import { getCostHistory, getPriceHistory } from "@/lib/admin/purchasing";
import { listSuppliersForVariant } from "@/lib/purchasing/suppliers";
import { one, parseRange, rangeLabel, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateShort, dateTime, int, money, moneyKpi, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TabLinks } from "@/components/admin/filter-bar";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { Thumb } from "@/components/admin/thumb";
import { AddVariantForm, ImageManager, ProductGeneralForm, ProductMenu, ProductSeoForm, VariantRowEditor } from "@/components/admin/product-forms";
import { AdjustButton, RestockButton } from "@/components/admin/stock-actions";
import { AddProductSupplierButton, RemoveSupplierProductButton } from "@/components/admin/purchasing-forms";
import { suppliers as suppliersTable } from "@/lib/db/schema";
import { MiniTrend } from "@/components/admin/charts";
import { KPICard } from "@/components/admin/kpi-card";
import { ReviewActions } from "@/components/admin/review-actions";

export const metadata = { title: "Product" };
const TABS = ["general", "variants", "images", "inventory", "seo", "analytics", "reviews", "suppliers", "cost-history", "price-history"] as const;

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const g = await guard("products:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params, sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const data = await getProduct(db, id);
  if (!data) notFound();
  const { product: p, variants, images, reviews, categories, collections } = data;
  const tab = (TABS as readonly string[]).includes(one(sp.tab) ?? "") ? (one(sp.tab) as (typeof TABS)[number]) : "general";
  const ro = !g.can("products:write"), canStock = g.can("inventory:write");
  const stock = variants.reduce((a, v) => a + v.availableStock, 0);
  const cat = categories.find((c) => c.id === p.categoryId);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/products" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Products</Link>
      <PageHeader title={p.name} description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={p.status} />{cat?.name} · {variants.length} variants · {int(stock)} available</span>}
        actions={<ProductMenu id={p.id} slug={p.slug} name={p.name} status={p.status} canWrite={!ro} />}>
        <TabLinks current={tab} tabs={[{ value: "general", label: "General" }, { value: "variants", label: "Variants", count: variants.length }, { value: "images", label: "Images", count: images.length }, { value: "inventory", label: "Inventory" }, { value: "seo", label: "SEO" }, { value: "analytics", label: "Analytics" }, { value: "reviews", label: "Reviews", count: reviews.length }, { value: "suppliers", label: "Suppliers" }, { value: "cost-history", label: "Cost history" }, { value: "price-history", label: "Price history" }]} />
      </PageHeader>

      {tab === "general" && <ProductGeneralForm p={{ ...p, collectionId: p.collectionId }} categories={categories} collections={collections} readOnly={ro} />}

      {tab === "variants" && (
        <Card>
          <CardHeader title="Variants" description="Price and cost changes are recorded in the audit log. Stock is changed on the Inventory tab." actions={!ro && <AddVariantForm productId={p.id} skuPrefix={`${cat?.skuPrefix}-${p.code}`} />} />
          <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Variants</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 pr-3 font-medium">Variant</th><th className="px-2 font-medium">Price (USD)</th><th className="px-2 font-medium">Cost (USD)</th><th className="hidden px-2 text-right font-medium md:table-cell">Margin</th><th className="hidden px-2 text-right font-medium sm:table-cell">Available</th><th className="hidden px-2 font-medium md:table-cell">Status</th><th className="px-2 pr-4" /></tr></thead>
            <tbody>{variants.map((v) => <VariantRowEditor key={v.id} v={v} readOnly={ro} />)}</tbody></table></div>
        </Card>
      )}

      {tab === "images" && <ImageManager productId={p.id} images={images} readOnly={ro} />}

      {tab === "inventory" && <InventoryTab db={db} variants={variants} productName={p.name} canStock={canStock} />}

      {tab === "seo" && <ProductSeoForm p={p} readOnly={ro} />}

      {tab === "analytics" && <AnalyticsTab db={db} productId={p.id} sp={sp} canOrders={g.can("orders:read")} />}

      {tab === "suppliers" && <SuppliersTab db={db} variants={variants} canWrite={!ro} />}

      {tab === "cost-history" && <CostHistoryTab db={db} variants={variants} sp={sp} />}

      {tab === "price-history" && <PriceHistoryTab db={db} variants={variants} sp={sp} />}

      {tab === "reviews" && (
        <Card>
          <CardHeader title="Reviews" description={`${reviews.filter((r) => r.status === "published").length} published · ${reviews.filter((r) => r.status === "pending").length} pending`} />
          {reviews.length ? <ul className="divide-y divide-line-soft">{reviews.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 max-w-2xl"><p className="text-[13px]"><span className="text-champagne" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span> <b className="font-medium">{r.title}</b></p><p className="mt-0.5 text-[13px] text-muted">{r.body}</p><p className="mt-1 text-xs text-subtle">{r.authorName} · {dateShort(r.createdAt)}</p></div>
              <div className="flex items-center gap-2"><StatusBadge status={r.status} />{g.can("reviews:write") && <ReviewActions id={r.id} status={r.status} />}</div>
            </li>))}</ul> : <EmptyState title="No reviews yet" />}
        </Card>
      )}
    </div>
  );
}

async function InventoryTab({ db, variants, productName, canStock }: { db: ReturnType<typeof getDb>; variants: VariantRow[]; productName: string; canStock: boolean }) {
    const suppliers = (await listSuppliers(db)).map((x) => x.name);
    return (
      <Card>
        <CardHeader title="Stock by variant" description="Available = stock − reserved for unpaid checkouts. Every change is recorded as a stock movement." actions={<Link href={`/admin/inventory/movements?q=${encodeURIComponent(variants[0]?.sku.split("-").slice(0, 2).join("-") ?? "")}`} className="text-xs font-medium text-accent hover:underline">Movements</Link>} />
        <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Stock by variant</caption>
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Variant</th><th className="num px-3 font-medium">Stock</th><th className="num hidden px-3 font-medium sm:table-cell">Reserved</th><th className="num px-3 font-medium">Available</th><th className="num hidden px-3 font-medium md:table-cell">Reorder at</th><th className="px-3 font-medium">Status</th><th className="num hidden px-3 font-medium lg:table-cell">Value</th><th className="pr-4" /></tr></thead>
          <tbody>{variants.map((v) => { const t = { variantId: v.id, productName, label: v.label, sku: v.sku, stockQuantity: v.stockQuantity, reservedQuantity: v.reservedQuantity, availableStock: v.availableStock, reorderLevel: v.reorderLevel, costPriceCents: v.costPriceCents }; return (
            <tr key={v.id} className="border-b border-line-soft last:border-0">
              <td className="py-2 pl-4"><div className="flex items-center gap-2"><Thumb src={v.image} alt="" size={32} /><div><p className="font-medium">{v.label}</p><p className="text-xs text-muted">{v.sku}</p></div></div></td>
              <td className="num px-3">{v.stockQuantity}</td><td className="num hidden px-3 sm:table-cell">{v.reservedQuantity}</td><td className="num px-3 font-semibold">{v.availableStock}</td><td className="num hidden px-3 md:table-cell">{v.reorderLevel}</td>
              <td className="px-3"><StatusBadge status={v.stockStatus} /></td><td className="num hidden px-3 lg:table-cell">{money(v.inventoryValueCents)}</td>
              <td className="py-2 pr-4 text-right">{canStock && <span className="inline-flex gap-1"><RestockButton target={t} suppliers={suppliers} /><AdjustButton target={t} /></span>}</td>
            </tr>); })}</tbody></table></div>
      </Card>
    );
  }


async function SuppliersTab({ db, variants, canWrite }: { db: ReturnType<typeof getDb>; variants: VariantRow[]; canWrite: boolean }) {
  const rows = (await Promise.all(variants.map(async (v) => ({ variant: v, suppliers: await listSuppliersForVariant(db, v.id) })))).flatMap((x) => x.suppliers.map((s) => ({ ...s, variant: x.variant })));
  const allSuppliers = await db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable);
  return (
    <Card>
      <CardHeader title="Suppliers" description="Every supplier that offers a variant of this product, and their terms. Never auto-selected — choose one when creating a purchase order." />
      {!rows.length ? <EmptyState title="No suppliers linked yet" description="Add one from a supplier's own profile page." /> : (
        <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Suppliers</caption>
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Variant</th><th className="px-2 font-medium">Supplier</th><th className="num px-2 font-medium">Price</th><th className="num hidden px-2 font-medium md:table-cell">MOQ</th><th className="num hidden px-2 font-medium lg:table-cell">Lead time</th><th className="hidden px-2 font-medium xl:table-cell">Last purchase</th><th className="px-2 font-medium">Preferred</th><th className="px-2 pr-4" /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-b border-line-soft last:border-0">
              <td className="py-2 pl-4">{r.variant.label} <span className="text-xs text-muted">({r.variant.sku})</span></td>
              <td className="px-2">{r.supplierName} <StatusBadge status={r.supplierStatus} /></td>
              <td className="num px-2">{money(r.purchasePriceCents)}</td>
              <td className="num hidden px-2 md:table-cell">{r.minimumOrderQuantity ?? "—"}</td>
              <td className="num hidden px-2 lg:table-cell">{r.leadTimeDays != null ? `${r.leadTimeDays}d` : "—"}</td>
              <td className="hidden px-2 xl:table-cell">{r.lastPurchaseDate ? `${dateShort(r.lastPurchaseDate)} · ${money(r.lastPurchasePriceCents ?? 0)}` : "—"}</td>
              <td className="px-2">{r.preferredSupplier ? <StatusBadge status="ACTIVE" label="Preferred" /> : "—"}</td>
              <td className="py-2 pr-4 text-right">{canWrite && <RemoveSupplierProductButton id={r.id} />}</td>
            </tr>))}</tbody></table></div>
      )}
      {canWrite && (
        <CardBody className="border-t border-line-soft">
          {!allSuppliers.length ? <p className="text-xs text-subtle">Add a supplier first from the Suppliers page.</p> : (
            <>
              <p className="mb-2 text-xs text-muted">Add a supplier for one of this product&apos;s variants:</p>
              <div className="flex flex-wrap gap-2">{variants.map((v) => <AddProductSupplierButton key={v.id} variantId={v.id} variantLabel={v.label} suppliers={allSuppliers} />)}</div>
            </>
          )}
        </CardBody>
      )}
    </Card>
  );
}

async function CostHistoryTab({ db, variants, sp }: { db: ReturnType<typeof getDb>; variants: VariantRow[]; sp: SearchParams }) {
  const res = await safe("cost-history", async () => (await Promise.all(variants.map(async (v) => (await getCostHistory(db, v.id)).map((h) => ({ ...h, sku: v.sku, label: v.label }))))).flat().sort((a, b) => b.date.getTime() - a.date.getTime()), one(sp.fail));
  if (!res.ok) return <Card><ErrorState message="Unable to load cost history." /></Card>;
  return (
    <Card>
      <CardHeader title="Cost history" description="From the inventory ledger — every purchase/restock that recorded a unit cost. Helps spot supplier price changes." />
      {!res.data.length ? <EmptyState title="No purchase history yet" /> : (
        <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Cost history</caption>
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Date</th><th className="px-2 font-medium">Variant</th><th className="px-2 font-medium">Supplier</th><th className="num px-2 font-medium">Unit cost</th><th className="num px-2 font-medium">Quantity</th><th className="hidden px-2 pr-4 font-medium md:table-cell">Reference</th></tr></thead>
          <tbody>{res.data.map((h, i) => (
            <tr key={i} className="border-b border-line-soft last:border-0">
              <td className="py-2 pl-4">{dateShort(h.date)}</td><td className="px-2">{h.label} <span className="text-xs text-muted">({h.sku})</span></td><td className="px-2">{h.supplierName ?? "—"}</td>
              <td className="num px-2">{money(h.unitCostCents)}</td><td className="num px-2">{h.quantity}</td><td className="hidden px-2 pr-4 text-muted md:table-cell">{h.referenceId ?? "—"}</td>
            </tr>))}</tbody></table></div>
      )}
    </Card>
  );
}

async function PriceHistoryTab({ db, variants, sp }: { db: ReturnType<typeof getDb>; variants: VariantRow[]; sp: SearchParams }) {
  const res = await safe("price-history", async () => (await Promise.all(variants.map(async (v) => (await getPriceHistory(db, v.id)).map((h) => ({ ...h, sku: v.sku, label: v.label }))))).flat().sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime()), one(sp.fail));
  if (!res.ok) return <Card><ErrorState message="Unable to load price history." /></Card>;
  return (
    <Card>
      <CardHeader title="Price history" description="Every selling-price or compare-at change, permanent and never overwritten." />
      {!res.data.length ? <EmptyState title="No price changes recorded yet" /> : (
        <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Price history</caption>
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Date</th><th className="px-2 font-medium">Variant</th><th className="num px-2 font-medium">Selling price</th><th className="num px-2 font-medium">Compare-at</th><th className="hidden px-2 pr-4 font-medium md:table-cell">Changed by</th></tr></thead>
          <tbody>{res.data.map((h, i) => (
            <tr key={i} className="border-b border-line-soft last:border-0">
              <td className="py-2 pl-4">{dateShort(h.effectiveAt)}</td><td className="px-2">{h.label} <span className="text-xs text-muted">({h.sku})</span></td>
              <td className="num px-2">{money(h.sellingPriceCents)}</td><td className="num px-2">{h.compareAtPriceCents != null ? money(h.compareAtPriceCents) : "—"}</td><td className="hidden px-2 pr-4 text-muted md:table-cell">{h.changedBy ?? "—"}</td>
            </tr>))}</tbody></table></div>
      )}
    </Card>
  );
}

async function AnalyticsTab({ db, productId, sp, canOrders }: { db: ReturnType<typeof getDb>; productId: string; sp: SearchParams; canOrders: boolean }) {
  const parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("product-analytics", () => getProductAnalytics(db, productId, r), one(sp.fail));
  if (!res.ok) return <Card><ErrorState message="Unable to load product analytics." /></Card>;
  const a = res.data;
  return (
    <div className="grid grid-cols-1 gap-4">
      <p className="text-[13px] text-muted">{rangeLabel(parsed)} · from order lines, so discounts are allocated per line and fully refunded orders are excluded.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KPICard label="Units sold" value={int(a.unitsSold)} change={null} comparison="" note={`${int(a.orders)} orders`} />
        <KPICard label="Revenue" value={moneyKpi(a.revenueCents)} change={null} comparison="" note="Line totals after discounts" />
        <KPICard label="COGS" value={moneyKpi(a.cogsCents)} change={null} comparison="" note="Unit cost at time of sale" />
        <KPICard label="Gross profit" value={moneyKpi(a.grossProfitCents)} change={null} comparison="" note="Revenue − COGS" />
        <KPICard label="Margin" value={pct(a.grossMarginPct)} change={null} comparison="" note="Profit ÷ revenue" />
      </div>
      <Card><CardHeader title="Sales trend" description={`Revenue per ${a.series.unit} for this product`} /><CardBody><MiniTrend points={a.series.points} unit={a.series.unit} dataKey="netRevenueCents" label="Revenue" format="money" /></CardBody></Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent orders containing this product" />
          {a.recentOrders.length ? <ul className="divide-y divide-line-soft text-[13px]">{a.recentOrders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">{canOrders ? <Link className="font-medium text-accent hover:underline" href={`/admin/orders/${o.id}`}>{o.orderNumber}</Link> : <b className="font-medium">{o.orderNumber}</b>} <span className="text-muted">· {o.customer} · {dateShort(o.placedAt)}</span></span>
              <span className="flex items-center gap-2"><span className="num">{o.quantity} × · {money(o.lineTotalCents)}</span><StatusBadge status={o.status} kind="order" /></span>
            </li>))}</ul> : <EmptyState title="No orders yet" />}
        </Card>
        <Card>
          <CardHeader title="Stock movements" actions={<Link href="/admin/inventory/movements" className="text-xs font-medium text-accent hover:underline">All movements</Link>} />
          {a.movements.length ? <ul className="divide-y divide-line-soft text-[13px]">{a.movements.map((m) => (
            <li key={m.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2">
              <StatusBadge status={m.type} />
              <span className="min-w-0 truncate text-muted">{m.sku} · {m.reference ?? m.notes ?? ""} · {dateTime(m.at)}</span>
              <span className="num"><b className={m.quantity < 0 ? "text-neg" : "text-pos"}>{m.quantity > 0 ? "+" : ""}{m.quantity}</b> <span className="text-subtle">{m.before}→{m.after}</span></span>
            </li>))}</ul> : <EmptyState title="No stock movements" />}
        </Card>
      </div>
    </div>
  );
}
