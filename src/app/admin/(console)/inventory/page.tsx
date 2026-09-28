import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { inventorySummary, inventoryValueBy, inventoryValueTrend, listStock, listSuppliers, lowStock, outOfStock } from "@/lib/admin/inventory";
import { listCategoriesWithCounts } from "@/lib/admin/products";
import { one, pageParams, parseRange, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateShort, int, money, moneyKpi } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect, SearchInput, TabLinks } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { Thumb } from "@/components/admin/thumb";
import { AdjustButton, RestockButton } from "@/components/admin/stock-actions";
import { KPICard } from "@/components/admin/kpi-card";
import { MiniTrend } from "@/components/admin/charts";
import { ExportMenu } from "@/components/admin/export-menu";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("inventory:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), fail = one(sp.fail);
  const view = ["current", "low", "out", "value"].includes(one(sp.view) ?? "") ? one(sp.view)! : "current";
  const { page, pageSize } = pageParams(sp, 30);
  const params = { view: view === "current" ? undefined : view, q: one(sp.q), status: one(sp.status), category: one(sp.category), sort: one(sp.sort), dir: one(sp.dir) };
  const canWrite = g.can("inventory:write");
  const [sum, suppliers] = await Promise.all([safe("inv-summary", () => inventorySummary(db), fail), listSuppliers(db).then((x) => x.map((s) => s.name))]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Inventory" description="Variant-level stock. Available = stock − reserved. Every change is a recorded movement."
        actions={<><Link href="/admin/inventory/movements" className="text-[13px] font-medium text-accent hover:underline">Stock movements</Link>{g.can("reports:read") && <ExportMenu report="inventory" params={{}} />}</>} />
      {sum.ok ? (
        <section aria-label="Inventory summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KPICard label="Total products" value={int(sum.data.totalProducts)} change={null} comparison="" note={`${int(sum.data.totalVariants)} variants`} />
          <KPICard label="Total units" value={int(sum.data.totalUnits)} change={null} comparison="" note="On hand" />
          <KPICard label="Inventory value" value={moneyKpi(sum.data.inventoryValueCents)} change={null} comparison="" note="Available × cost" href="/admin/inventory?view=value" />
          <KPICard label="Low stock" value={int(sum.data.lowStock)} change={null} comparison="" note="At or below reorder level" tone={sum.data.lowStock ? "warn" : undefined} href="/admin/inventory?view=low" />
          <KPICard label="Out of stock" value={int(sum.data.outOfStock)} change={null} comparison="" note="Nothing available" tone={sum.data.outOfStock ? "neg" : undefined} href="/admin/inventory?view=out" />
          <KPICard label="Reserved units" value={int(sum.data.reservedUnits)} change={null} comparison="" note="Held by unpaid checkouts" />
        </section>
      ) : <Card><ErrorState message="Unable to load inventory data." /></Card>}

      <TabLinks param="view" current={view} tabs={[{ value: "current", label: "Current inventory" }, { value: "low", label: "Low stock", count: sum.ok ? sum.data.lowStock : undefined }, { value: "out", label: "Out of stock", count: sum.ok ? sum.data.outOfStock : undefined }, { value: "value", label: "Value" }]} />

      {view === "current" && <CurrentTable />}
      {(view === "low" || view === "out") && <AlertTable kind={view} />}
      {view === "value" && <ValueView />}
    </div>
  );

  async function CurrentTable() {
    const res = await safe("stock", async () => ({ list: await listStock(db, { ...params, page, pageSize }), cats: await listCategoriesWithCounts(db) }), fail);
    return (
      <Card>
        <FilterBar>
          <SearchInput placeholder="Search product, SKU, barcode or variant" />
          <FilterSelect param="status" label="Status" options={[{ value: "IN_STOCK", label: "In stock" }, { value: "LOW_STOCK", label: "Low stock" }, { value: "OUT_OF_STOCK", label: "Out of stock" }]} />
          {res.ok && <FilterSelect param="category" label="Category" options={res.data.cats.map((c) => ({ value: c.slug, label: c.name }))} />}
        </FilterBar>
        {!res.ok ? <ErrorState message="Unable to load inventory." /> : <>
          <DataTable caption="Current inventory" rows={res.data.list.rows} rowKey={(x) => x.variantId} basePath="/admin/inventory" params={params} sort={params.sort ?? "product"} dir={params.dir ?? "asc"} dense
            empty={<EmptyState title="No variants match" />}
            columns={[
              { key: "img", header: <span className="sr-only">Image</span>, cell: (x) => <Thumb src={x.image} alt="" size={34} />, className: "w-[48px]" },
              { key: "p", header: "Product", sortKey: "product", cell: (x) => <div className="min-w-0"><Link href={`/admin/products/${x.productId}?tab=inventory`} className="font-medium hover:underline">{x.productName}</Link><p className="truncate text-xs text-muted">{x.label}</p></div> },
              { key: "sku", header: "SKU", sortKey: "sku", cell: (x) => <span className="whitespace-nowrap text-xs text-muted">{x.sku}</span>, hideBelow: "md" },
              { key: "cost", header: "Cost", align: "right", cell: (x) => money(x.costPriceCents), hideBelow: "xl" },
              { key: "price", header: "Price", align: "right", cell: (x) => money(x.sellingPriceCents), hideBelow: "xl" },
              { key: "stock", header: "Stock", align: "right", cell: (x) => x.stockQuantity, hideBelow: "sm" },
              { key: "res", header: "Reserved", align: "right", cell: (x) => x.reservedQuantity || <span className="text-subtle">0</span>, hideBelow: "lg" },
              { key: "av", header: "Available", sortKey: "available", align: "right", cell: (x) => <b className={cn(x.status === "OUT_OF_STOCK" && "text-neg", x.status === "LOW_STOCK" && "text-warn")}>{x.availableStock}</b> },
              { key: "ro", header: "Reorder at", align: "right", cell: (x) => x.reorderLevel, hideBelow: "lg" },
              { key: "st", header: "Status", sortKey: "status", cell: (x) => <StatusBadge status={x.status} />, hideBelow: "sm" },
              { key: "act", header: <span className="sr-only">Actions</span>, align: "right", cell: (x) => canWrite ? <span className="inline-flex gap-1"><RestockButton target={x} suppliers={suppliers} /><AdjustButton target={x} /></span> : null },
            ]} />
          <Pagination {...res.data.list} basePath="/admin/inventory" params={params} />
        </>}
      </Card>
    );
  }

  async function AlertTable({ kind }: { kind: "low" | "out" }) {
    const res = await safe(kind, () => (kind === "low" ? lowStock(db, 500) : outOfStock(db, 500)), fail);
    if (!res.ok) return <Card><ErrorState message="Unable to load inventory alerts." /></Card>;
    return (
      <Card>
        <CardHeader title={kind === "low" ? "Low stock, most urgent first" : "Out of stock, best sellers first"} description="Days remaining and suggested quantities are estimates from the last 30 days of sales, covering about 45 days." />
        <DataTable caption={kind === "low" ? "Low stock" : "Out of stock"} rows={res.data} rowKey={(x) => x.variantId} basePath="/admin/inventory" params={{ view: kind }}
          empty={<EmptyState title={kind === "low" ? "Nothing is running low" : "Nothing is out of stock"} />}
          columns={[
            { key: "p", header: "Product", cell: (x) => <div className="flex items-center gap-2.5"><Thumb src={x.image} alt="" size={34} /><div className="min-w-0"><Link href={`/admin/products/${x.productId}?tab=inventory`} className="font-medium hover:underline">{x.productName}</Link><p className="truncate text-xs text-muted">{x.label}</p></div></div> },
            { key: "sku", header: "SKU", cell: (x) => <span className="whitespace-nowrap text-xs text-muted">{x.sku}</span>, hideBelow: "md" },
            { key: "av", header: kind === "low" ? "Current stock" : "Available", align: "right", cell: (x) => <b className={kind === "low" ? "text-warn" : "text-neg"}>{x.availableStock}</b> },
            { key: "ro", header: "Reorder at", align: "right", cell: (x) => x.reorderLevel, hideBelow: "sm" },
            ...(kind === "low"
              ? [{ key: "d", header: "Est. days left", align: "right" as const, cell: (x: (typeof res.data)[number]) => (x.estimatedDaysRemaining == null ? <span className="text-subtle">no recent sales</span> : `≈ ${x.estimatedDaysRemaining}`) }]
              : [{ key: "l", header: "Last sold", cell: (x: (typeof res.data)[number]) => (x.lastSoldAt ? dateShort(x.lastSoldAt) : <span className="text-subtle">never</span>), hideBelow: "sm" as const }]),
            { key: "s30", header: "Sold (30d)", align: "right", cell: (x) => x.sold30, hideBelow: "sm" },
            { key: "sug", header: "Suggested reorder", align: "right", cell: (x) => <span title="Estimate">{x.suggestedReorderQuantity}</span>, hideBelow: "md" },
            { key: "act", header: <span className="sr-only">Action</span>, align: "right", cell: (x) => canWrite ? <RestockButton target={x} suppliers={suppliers} variant={kind === "out" ? "primary" : "secondary"} /> : null },
          ]} />
      </Card>
    );
  }

  async function ValueView() {
    const parsed = parseRange(sp, "90d"), r = await resolveRange(db, parsed.key, parsed.custom);
    const res = await safe("value", async () => ({ cat: await inventoryValueBy(db, "category"), prod: await inventoryValueBy(db, "product", 12), trend: await inventoryValueTrend(db, r) }), fail);
    if (!res.ok) return <Card><ErrorState message="Unable to load inventory value." /></Card>;
    const List = ({ rows }: { rows: typeof res.data.cat }) => (
      <ul className="grid grid-cols-1 gap-2">{rows.map((c) => (
        <li key={c.label} className="grid grid-cols-[minmax(90px,160px)_1fr_auto_auto] items-center gap-3 text-[13px]"><span className="truncate">{c.label}</span><span className="h-2 rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${c.sharePct}%` }} /></span><span className="num w-24">{money(c.valueCents)}</span><span className="num w-12 text-muted">{c.sharePct}%</span></li>
      ))}</ul>
    );
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card><CardHeader title="Value by category" description="Available stock × current cost price" /><CardBody><List rows={res.data.cat} /></CardBody></Card>
          <Card><CardHeader title="Value by product (top 12)" /><CardBody><List rows={res.data.prod} /></CardBody></Card>
        </div>
        <Card><CardHeader title="Inventory value trend (estimate)" description="Stock on hand at the end of each day, rebuilt from the movement ledger and valued at today’s cost prices. Historical cost changes are not versioned." /><CardBody>
          <MiniTrend points={res.data.trend.map((t) => ({ bucket: `${t.day}T00:00`, value: t.valueCents }))} unit="day" dataKey="value" label="Inventory value" format="money" />
        </CardBody></Card>
      </div>
    );
  }
}
