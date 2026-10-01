import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getSalesBy, resolveRange } from "@/lib/analytics/service";
import { getProductFunnelExtras } from "@/lib/analytics/marketing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { rows } from "@/lib/admin/sql";
import { safe } from "@/lib/admin/safe";
import { int, money, pct } from "@/lib/format";
import { sql } from "drizzle-orm";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { Thumb } from "@/components/admin/thumb";
import { ExportMenu } from "@/components/admin/export-menu";

export const metadata = { title: "Product analytics" };
const SORT = { units: "units", revenue: "netRevenueCents", cogs: "cogsCents", profit: "grossProfitCents", margin: "grossMarginPct", stock: "stock", name: "label", views: "views", cart: "addToCart" } as const;

export default async function ProductAnalytics({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const sort = (one(sp.sort) ?? "revenue") as keyof typeof SORT, dir = one(sp.dir) ?? (sort === "name" ? "asc" : "desc");
  const res = await safe("products", async () => {
    const [sales, all, funnel] = await Promise.all([
      getSalesBy(db, r, "product"),
      rows<{ product_id: string; name: string; available: string; image: string | null }>(db, sql`select vs.product_id, max(vs.product_name) as name, sum(vs.available_stock) as available, (select url from product_images pi where pi.product_id = vs.product_id order by position limit 1) as image from variant_stock vs where vs.product_status <> 'archived' group by vs.product_id`),
      getProductFunnelExtras(db, r),
    ]);
    // Every active product appears, including those with no sales in the period (they matter most).
    const byId = new Map(sales.map((s) => [s.key, s]));
    return all.map((p) => {
      const s = byId.get(p.product_id), f = funnel.get(p.product_id);
      const views = f?.views ?? 0, units = s?.units ?? 0;
      return {
        key: p.product_id, label: p.name, image: p.image, stock: Number(p.available), units, netRevenueCents: s?.netRevenueCents ?? 0, cogsCents: s?.cogsCents ?? 0, grossProfitCents: s?.grossProfitCents ?? 0, grossMarginPct: s?.grossMarginPct ?? 0,
        views, wishlistAdds: f?.wishlistAdds ?? 0, addToCart: f?.addToCart ?? 0, orders: s?.orders ?? 0, conversionRate: views ? Math.round((units / views) * 1000) / 10 : null,
      };
    });
  }, one(sp.fail));
  const params = { ...rangeQuery(parsed), sort: one(sp.sort), dir: one(sp.dir) };
  const data = res.ok ? [...res.data].sort((a, b) => { const k = SORT[sort] ?? "netRevenueCents"; const x = a[k], y = b[k]; const c = typeof x === "string" ? x.localeCompare(String(y)) : Number(x) - Number(y); return dir === "asc" ? c : -c; }) : [];
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Product analytics" description={`${rangeLabel(parsed)} · profit = revenue − COGS, from order-line snapshots`} actions={g.can("reports:read") && <ExportMenu report="product-performance" params={{}} />}>
        <AnalyticsNav current="products" query={rangeQuery(parsed)} />
      </PageHeader>
      <Card>
        {!res.ok ? <ErrorState message="Unable to load product analytics." /> :
          <DataTable caption="Product performance" rows={data} rowKey={(x) => x.key} basePath="/admin/analytics/products" params={params} sort={sort} dir={dir}
            empty={<EmptyState title="No products" />}
            columns={[
              { key: "p", header: "Product", sortKey: "name", cell: (x) => <div className="flex items-center gap-2.5"><Thumb src={x.image} alt="" size={34} />{g.can("products:read") ? <Link href={`/admin/products/${x.key}?tab=analytics&${new URLSearchParams(rangeQuery(parsed))}`} className="font-medium hover:underline">{x.label}</Link> : <span className="font-medium">{x.label}</span>}</div> },
              { key: "v", header: "Views", sortKey: "views", align: "right", cell: (x) => int(x.views), hideBelow: "lg" },
              { key: "w", header: "Wishlist adds", align: "right", cell: (x) => int(x.wishlistAdds), hideBelow: "xl" },
              { key: "ca", header: "Add to cart", sortKey: "cart", align: "right", cell: (x) => int(x.addToCart), hideBelow: "lg" },
              { key: "u", header: "Units sold", sortKey: "units", align: "right", cell: (x) => (x.units ? int(x.units) : <span className="text-subtle">0</span>) },
              { key: "r", header: "Revenue", sortKey: "revenue", align: "right", cell: (x) => money(x.netRevenueCents) },
              { key: "c", header: "COGS", sortKey: "cogs", align: "right", cell: (x) => money(x.cogsCents), hideBelow: "md" },
              { key: "g", header: "Profit", sortKey: "profit", align: "right", cell: (x) => money(x.grossProfitCents), hideBelow: "sm" },
              { key: "m", header: "Margin", sortKey: "margin", align: "right", cell: (x) => (x.netRevenueCents ? pct(x.grossMarginPct) : "—"), hideBelow: "sm" },
              { key: "cv", header: "Conv. rate", align: "right", cell: (x) => (x.conversionRate == null ? "—" : pct(x.conversionRate)), hideBelow: "xl" },
              { key: "s", header: "Stock", sortKey: "stock", align: "right", cell: (x) => <span className={x.stock <= 0 ? "text-neg" : ""}>{int(x.stock)}</span>, hideBelow: "md" },
            ]} />}
      </Card>
    </div>
  );
}
