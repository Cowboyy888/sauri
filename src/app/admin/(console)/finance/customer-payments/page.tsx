import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { listCustomerPayments, type CustomerPaymentRow } from "@/lib/finance/customer-payments";
import { guard } from "@/lib/admin/guard";
import { one, pageParams, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, dateTime } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Col } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const metadata = { title: "Customer payments" };

export default async function CustomerPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const { page, pageSize } = pageParams(sp);
  const res = await safe("customer-payments", () => listCustomerPayments(db, { range: r, page, pageSize }), one(sp.fail));

  const columns: Col<CustomerPaymentRow>[] = [
    { key: "order", header: "Order", cell: (x) => <Link href={`/admin/orders/${x.orderId}`} className="font-medium text-accent hover:underline">{x.orderNumber}</Link> },
    { key: "date", header: "Date", cell: (x) => dateTime(x.paidAt ?? x.createdAt) },
    { key: "provider", header: "Provider", cell: (x) => x.provider },
    { key: "reference", header: "Reference", cell: (x) => <span className="font-mono text-xs">{x.transactionRef ?? "—"}</span>, hideBelow: "lg" },
    { key: "amount", header: "Amount", cell: (x) => money(x.amountCents), align: "right" },
    { key: "refunded", header: "Refunded", cell: (x) => (x.refundedCents ? money(x.refundedCents) : "—"), align: "right", hideBelow: "sm" },
    { key: "status", header: "Status", cell: (x) => <StatusBadge status={x.status} />, align: "right" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Customer payments" description={rangeLabel(parsed)}>
        <FinanceNav current="customer-payments" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load customer payments." /> : (
        <Card>
          <CardBody className="p-0">
            <DataTable columns={columns} rows={res.data.rows} rowKey={(x) => x.id} basePath="/admin/finance/customer-payments" params={rangeQuery(parsed)}
              empty={<EmptyState title="No payments in this period" />} caption="Customer payments" />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
