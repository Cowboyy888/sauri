import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listCustomers } from "@/lib/admin/customers";
import { SEGMENT_KEYS, SEGMENT_LABELS, type SegmentKey } from "@/lib/crm/segments";
import { one, pageParams, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateShort, int, money, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { ExportMenu } from "@/components/admin/export-menu";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("customers:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), { page, pageSize } = pageParams(sp);
  const segment = one(sp.segment) as SegmentKey | undefined;
  const params = { q: one(sp.q), segment, sort: one(sp.sort), dir: one(sp.dir) };
  const res = await safe("customers", () => listCustomers(db, { q: params.q, segment: segment && SEGMENT_KEYS.includes(segment) ? segment : undefined, sort: params.sort, dir: params.dir, page, pageSize }), one(sp.fail));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Customers" description="Lifetime figures from paid orders. Revenue is net of discounts and refunds; profit is gross profit."
        actions={<>
          <Link href="/admin/customers/segments" className="text-[13px] font-medium text-accent hover:underline">Segments</Link>
          {g.can("sales:read") && <Link href="/admin/analytics/customers" className="text-[13px] font-medium text-accent hover:underline">Customer analytics</Link>}
          {g.can("reports:read") && <ExportMenu report="customers" params={{ range: "all" }} />}
        </>} />
      <Card>
        <FilterBar>
          <SearchInput placeholder="Search name, email, or phone" />
          <FilterSelect param="segment" label="Segment" options={SEGMENT_KEYS.map((k) => ({ value: k, label: SEGMENT_LABELS[k].label }))} />
        </FilterBar>
        {!res.ok ? <ErrorState message="Unable to load customers." /> : <>
          <DataTable caption="Customers" rows={res.data.rows} rowKey={(c) => c.id} basePath="/admin/customers" params={params} sort={params.sort ?? "revenue"} dir={params.dir}
            empty={<EmptyState title="No customers match" />}
            columns={[
              { key: "n", header: "Customer", sortKey: "name", cell: (c) => <div className="min-w-0 max-w-[220px]"><Link href={`/admin/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link><p className="truncate text-xs text-muted">{c.email}</p></div> },
              { key: "ph", header: "Phone", cell: (c) => c.phone ?? <span className="text-subtle">—</span>, hideBelow: "xl" },
              { key: "o", header: "Orders", sortKey: "orders", align: "right", cell: (c) => int(c.orders) },
              { key: "r", header: "Revenue", sortKey: "revenue", align: "right", cell: (c) => money(c.revenueCents) },
              { key: "p", header: "Profit", sortKey: "profit", align: "right", cell: (c) => money(c.profitCents), hideBelow: "md" },
              { key: "a", header: "Average order", sortKey: "aov", align: "right", cell: (c) => money(c.averageOrderCents), hideBelow: "lg" },
              { key: "l", header: "Last order", sortKey: "last", cell: (c) => (c.lastOrderAt ? dateShort(c.lastOrderAt) : <span className="text-subtle">never</span>), hideBelow: "sm" },
              { key: "s", header: "Customer since", sortKey: "since", cell: (c) => dateShort(c.customerSince), hideBelow: "lg" },
              { key: "ac", header: "Source", cell: (c) => c.acquisitionSource ? titleCase(c.acquisitionSource) : <span className="text-subtle">—</span>, hideBelow: "xl" },
            ]} />
          <Pagination {...res.data} basePath="/admin/customers" params={params} />
        </>}
      </Card>
    </div>
  );
}
