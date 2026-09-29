import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { listReturns } from "@/lib/admin/returns";
import { one, pageParams, parseRange, rangeLabel, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Returns" };
const STATUSES = ["requested", "under_review", "approved", "rejected", "return_shipped", "received", "inspecting", "approved_for_refund", "refunded", "closed"];

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("orders:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp, "all"), r = await resolveRange(db, parsed.key, parsed.custom);
  const { page, pageSize } = pageParams(sp);
  const params = { q: one(sp.q), status: one(sp.status), sort: one(sp.sort), dir: one(sp.dir), range: one(sp.range), from: one(sp.from), to: one(sp.to) };
  const res = await safe("returns", () => listReturns(db, { q: params.q, status: params.status, range: r, sort: params.sort, dir: params.dir, page, pageSize }), one(sp.fail));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Returns" description={`${rangeLabel(parsed)} · by date requested. Every return must be inspected before anything is restocked (brief §24).`} />
      <Card>
        <FilterBar>
          <SearchInput placeholder="Search order number, customer name or email" />
          <FilterSelect param="status" label="Status" options={STATUSES.map((s) => ({ value: s, label: s.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") }))} />
        </FilterBar>
        {!res.ok ? <ErrorState message="Unable to load returns." /> : <>
          <DataTable caption="Returns" rows={res.data.rows} rowKey={(x) => x.id} basePath="/admin/returns" params={params} sort={params.sort ?? "date"} dir={params.dir}
            empty={<EmptyState title="No returns match these filters" description="Try a wider date range or clear a filter." />}
            columns={[
              { key: "o", header: "Order", cell: (x) => <Link href={`/admin/returns/${x.id}`} className="font-medium text-accent hover:underline">{x.orderNumber}</Link> },
              { key: "c", header: "Customer", sortKey: "customer", cell: (x) => <div className="min-w-0 max-w-[200px]"><p className="truncate">{x.customer}</p><p className="truncate text-xs text-muted">{x.email}</p></div> },
              { key: "d", header: "Requested", sortKey: "date", cell: (x) => <span className="whitespace-nowrap">{dateTime(x.requestedAt)}</span> },
              { key: "i", header: "Items", align: "right", cell: (x) => x.itemCount, hideBelow: "sm" },
              { key: "s", header: "Status", sortKey: "status", cell: (x) => <StatusBadge status={x.status} /> },
            ]} />
          <Pagination {...res.data} basePath="/admin/returns" params={params} />
        </>}
      </Card>
    </div>
  );
}
