import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { listChannels, listOrders } from "@/lib/admin/orders";
import { one, pageParams, parseRange, rangeLabel, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateTime, money, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { ExportMenu } from "@/components/admin/export-menu";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Orders" };
const STATUSES = ["pending", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("orders:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const { page, pageSize } = pageParams(sp);
  const params = { q: one(sp.q), status: one(sp.status), payment: one(sp.payment), channel: one(sp.channel), customer: one(sp.customer), sort: one(sp.sort), dir: one(sp.dir), range: one(sp.range), from: one(sp.from), to: one(sp.to) };
  const res = await safe("orders", async () => ({
    list: await listOrders(db, { q: params.q, status: params.status, paymentStatus: params.payment, channel: params.channel, customerId: params.customer && /^[0-9a-f-]{36}$/.test(params.customer) ? params.customer : undefined, range: r, sort: params.sort, dir: params.dir, page, pageSize }),
    channels: await listChannels(db),
  }), one(sp.fail));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Orders" description={`${rangeLabel(parsed)} · by date placed. Profit is gross profit (revenue − COGS).`} actions={g.can("reports:read") && <ExportMenu report="orders" params={{}} />} />
      <Card>
        <FilterBar>
          <SearchInput placeholder="Search order number, customer name or email" />
          <FilterSelect param="status" label="Status" options={STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />
          <FilterSelect param="payment" label="Payment" options={[["unpaid", "Unpaid"], ["paid", "Paid"], ["refunded", "Refunded"], ["failed", "Failed"]].map(([value, label]) => ({ value: value!, label: label! }))} />
          {res.ok && <FilterSelect param="channel" label="Channel" options={res.data.channels.map((c) => ({ value: c.code, label: c.name }))} />}
          {params.customer && <Link href={`/admin/orders`} className="rounded-md bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent">One customer · clear</Link>}
        </FilterBar>
        {!res.ok ? <ErrorState message="Unable to load orders." /> : <>
          <DataTable caption="Orders" rows={res.data.list.rows} rowKey={(o) => o.id} basePath="/admin/orders" params={params} sort={params.sort ?? "date"} dir={params.dir}
            empty={<EmptyState title="No orders match these filters" description="Try a wider date range or clear a filter." />}
            columns={[
              { key: "n", header: "Order", sortKey: "number", cell: (o) => <Link href={`/admin/orders/${o.id}`} className="font-medium text-accent hover:underline">{o.orderNumber}</Link> },
              { key: "c", header: "Customer", sortKey: "customer", cell: (o) => <div className="min-w-0 max-w-[200px]"><p className="truncate">{o.customer}</p><p className="truncate text-xs text-muted">{o.email}</p></div> },
              { key: "d", header: "Date", sortKey: "date", cell: (o) => <span className="whitespace-nowrap">{dateTime(o.placedAt)}</span>, hideBelow: "sm" },
              { key: "ch", header: "Channel", cell: (o) => o.channel, hideBelow: "lg" },
              { key: "i", header: "Items", align: "right", cell: (o) => o.items, hideBelow: "xl" },
              { key: "p", header: "Payment", cell: (o) => <StatusBadge status={o.paymentStatus} />, hideBelow: "md" },
              { key: "s", header: "Status", cell: (o) => <StatusBadge status={o.status} kind="order" /> },
              { key: "t", header: "Total", sortKey: "total", align: "right", cell: (o) => money(o.totalCents) },
              { key: "g", header: "Profit", sortKey: "profit", align: "right", cell: (o) => <span className={cn(o.grossProfitCents < 0 && "text-neg")} title={`${pct(o.grossMargin)} margin`}>{money(o.grossProfitCents)}</span>, hideBelow: "md" },
            ]} />
          <Pagination {...res.data.list} basePath="/admin/orders" params={params} />
        </>}
      </Card>
    </div>
  );
}
