import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { listReconciliationCandidates, type ReconciliationRow } from "@/lib/finance/reconciliation";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, dateTime } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Col } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { RunReconciliationButton, ManualReconciliationButton, MarkReviewedButton } from "@/components/admin/finance-forms";

export const metadata = { title: "Reconciliation" };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("reconciliation", () => listReconciliationCandidates(db, r), one(sp.fail));
  const canWrite = g.can("finance:write");

  const columns: Col<ReconciliationRow>[] = [
    { key: "order", header: "Order", cell: (x) => <Link href={`/admin/orders/${x.orderId}`} className="font-medium text-accent hover:underline">{x.orderNumber}</Link> },
    { key: "date", header: "Date", cell: (x) => dateTime(x.paidAt) },
    { key: "ref", header: "Transaction ID", cell: (x) => <span className="font-mono text-xs">{x.transactionRef ?? "—"}</span>, hideBelow: "md" },
    { key: "internal", header: "Internal amount", cell: (x) => money(x.internalAmountCents), align: "right" },
    { key: "external", header: "External amount", cell: (x) => (x.externalAmountCents == null ? "—" : money(x.externalAmountCents)), align: "right" },
    { key: "diff", header: "Difference", cell: (x) => (x.externalAmountCents == null ? "—" : money(x.internalAmountCents - x.externalAmountCents)), align: "right", hideBelow: "sm" },
    { key: "status", header: "Status", cell: (x) => <StatusBadge status={x.status} />, align: "right" },
    ...(canWrite ? [{
      key: "actions", header: "", align: "right" as const,
      cell: (x: ReconciliationRow) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <RunReconciliationButton paymentId={x.paymentId} provider={x.provider} />
          <ManualReconciliationButton paymentId={x.paymentId} />
          {!x.reviewedAt && <MarkReviewedButton id={x.id} />}
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Reconciliation" description={`${rangeLabel(parsed)} · compares our payment records against the payment provider's own records.`}>
        <FinanceNav current="reconciliation" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load reconciliation data." /> : (
        <Card>
          <CardBody className="p-0">
            <DataTable columns={columns} rows={res.data} rowKey={(x) => x.paymentId} basePath="/admin/finance/reconciliation" params={rangeQuery(parsed)}
              empty={<EmptyState title="No payments in this period" />} caption="Reconciliation" />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
