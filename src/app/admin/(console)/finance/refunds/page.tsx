import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { listRefunds, getRefundAnalytics, type RefundListRow } from "@/lib/finance/refunds";
import { guard } from "@/lib/admin/guard";
import { one, pageParams, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int, pct, dateTime } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { DataTable, type Col } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/states";

export const metadata = { title: "Refunds" };

export default async function RefundsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const { page, pageSize } = pageParams(sp);
  const res = await safe("refunds", async () => ({ list: await listRefunds(db, { range: r, page, pageSize }), analytics: await getRefundAnalytics(db, r) }), one(sp.fail));

  const columns: Col<RefundListRow>[] = [
    { key: "order", header: "Order", cell: (x) => <Link href={`/admin/orders/${x.orderId}`} className="font-medium text-accent hover:underline">{x.orderNumber}</Link> },
    { key: "date", header: "Date", cell: (x) => dateTime(x.createdAt) },
    { key: "customer", header: "Customer", cell: (x) => x.customerName },
    { key: "amount", header: "Amount", cell: (x) => money(x.amountCents), align: "right" },
    { key: "reason", header: "Reason", cell: (x) => x.reason ?? "—", hideBelow: "md" },
    { key: "restocked", header: "Restocked", cell: (x) => (x.restocked ? "Yes" : "No"), hideBelow: "sm" },
    { key: "processed_by", header: "Processed by", cell: (x) => x.processedBy ?? "—", hideBelow: "lg" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Refunds" description={rangeLabel(parsed)}>
        <FinanceNav current="refunds" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load refund data." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPICard label="Total refunds" value={money(res.data.analytics.totalRefundsCents)} change={null} comparison="" />
            <KPICard label="Refund count" value={int(res.data.analytics.refundCount)} change={null} comparison="" />
            <KPICard label="Refund rate" value={res.data.analytics.refundRatePct == null ? "N/A" : pct(res.data.analytics.refundRatePct)} change={null} comparison="" hint="Refunds ÷ recognized orders" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Refunds by reason" />
              <CardBody className="grid grid-cols-1 gap-1.5">
                {res.data.analytics.byReason.length === 0 ? <EmptyState title="No refunds in this period" /> : res.data.analytics.byReason.map((x) => (
                  <div key={x.reason} className="flex items-center justify-between text-[13px]"><span>{x.reason}</span><span className="font-medium num">{money(x.totalCents)} ({int(x.count)})</span></div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Refunds by product" description="Estimated: allocated pro rata across each order's lines." />
              <CardBody className="grid grid-cols-1 gap-1.5">
                {res.data.analytics.byProduct.length === 0 ? <EmptyState title="No refunds in this period" /> : res.data.analytics.byProduct.slice(0, 10).map((x) => (
                  <div key={x.productName} className="flex items-center justify-between text-[13px]"><span className="truncate">{x.productName}</span><span className="font-medium num">{money(x.totalCents)}</span></div>
                ))}
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardBody className="p-0">
              <DataTable columns={columns} rows={res.data.list.rows} rowKey={(x) => x.id} basePath="/admin/finance/refunds" params={rangeQuery(parsed)}
                empty={<EmptyState title="No refunds in this period" />} caption="Refunds" />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
