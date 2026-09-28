import Link from "next/link";
import { Plus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { listCategoriesWithCounts, listProducts } from "@/lib/admin/products";
import { listSuppliers } from "@/lib/admin/inventory";
import { one, pageParams, parseRange, rangeLabel, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { int, money } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { Thumb } from "@/components/admin/thumb";
import { ProductMenu } from "@/components/admin/product-forms";

export const metadata = { title: "Products" };
const range = (lo: number, hi: number) => (lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("products:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const { page, pageSize } = pageParams(sp);
  const params = { q: one(sp.q), category: one(sp.category), status: one(sp.status), sort: one(sp.sort), dir: one(sp.dir), range: one(sp.range), from: one(sp.from), to: one(sp.to) };
  const res = await safe("products", async () => ({ list: await listProducts(db, { ...params, page, pageSize, range: r }), cats: await listCategoriesWithCounts(db), suppliers: await listSuppliers(db) }), one(sp.fail));
  const canWrite = g.can("products:write");
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Products" description={`Units sold and revenue for ${rangeLabel(parsed).toLowerCase()}. Search covers name, SKU, barcode, category and variant.`}
        actions={canWrite && <Link href="/admin/products/new" className={buttonVariants({ variant: "primary" })}><Plus />New product</Link>} />
      <Card>
        <FilterBar>
          <SearchInput placeholder="Search name, SKU, barcode, category, variant" />
          {res.ok && <FilterSelect param="category" label="Category" options={res.data.cats.map((c) => ({ value: c.slug, label: c.name }))} />}
          <FilterSelect param="status" label="Status" allLabel="Active and draft" options={[{ value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]} />
        </FilterBar>
        {!res.ok ? <ErrorState message="Unable to load products." /> : <>
          <DataTable caption="Products" rows={res.data.list.rows} rowKey={(p) => p.id} basePath="/admin/products" params={params} sort={params.sort ?? "revenue"} dir={params.dir}
            empty={<EmptyState title={params.q ? `No products match “${params.q}”` : "No products yet"} description={params.q ? "Try a SKU, barcode or part of the name." : undefined} />}
            columns={[
              { key: "img", header: <span className="sr-only">Image</span>, cell: (p) => <Thumb src={p.image} alt="" size={40} />, className: "w-[56px]" },
              { key: "name", header: "Product", sortKey: "name", cell: (p) => <div className="min-w-0"><Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link><p className="text-xs text-muted">{p.variants} {p.variants === 1 ? "variant" : "variants"}</p></div> },
              { key: "sku", header: "SKU prefix", cell: (p) => <span className="whitespace-nowrap text-xs text-muted">{p.sku}-…</span>, hideBelow: "lg" },
              { key: "cat", header: "Category", cell: (p) => p.category, hideBelow: "md" },
              { key: "price", header: "Price", sortKey: "price", align: "right", cell: (p) => range(p.priceMinCents, p.priceMaxCents), hideBelow: "sm" },
              { key: "cost", header: "Cost", align: "right", cell: (p) => range(p.costMinCents, p.costMaxCents), hideBelow: "xl" },
              { key: "stock", header: "Stock", sortKey: "stock", align: "right", cell: (p) => <span className={p.available <= 0 ? "text-neg" : ""} title={`${p.stock} on hand, ${p.stock - p.available} reserved`}>{int(p.available)}</span> },
              { key: "units", header: "Units sold", sortKey: "units", align: "right", cell: (p) => int(p.unitsSold), hideBelow: "md" },
              { key: "rev", header: "Revenue", sortKey: "revenue", align: "right", cell: (p) => money(p.revenueCents), hideBelow: "sm" },
              { key: "status", header: "Status", sortKey: "status", cell: (p) => <StatusBadge status={p.status} />, hideBelow: "md" },
              { key: "act", header: <span className="sr-only">Actions</span>, align: "right", cell: (p) => (
                <span className="inline-flex items-center gap-1">
                  <Link href={`/admin/products/${p.id}`} className="hidden text-xs font-medium text-accent hover:underline sm:inline">Edit</Link>
                  {g.can("inventory:write") && <Link href={`/admin/products/${p.id}?tab=inventory`} className="hidden px-1.5 text-xs font-medium text-accent hover:underline lg:inline">Restock</Link>}
                  <ProductMenu id={p.id} slug={p.slug} name={p.name} status={p.status} canWrite={canWrite} compact />
                </span>) },
            ]} />
          <Pagination {...res.data.list} basePath="/admin/products" params={params} />
        </>}
      </Card>
    </div>
  );
}
