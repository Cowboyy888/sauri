import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { listExpenses, type ExpenseListRow } from "@/lib/finance/expenses";
import { listExpenseCategories } from "@/lib/finance/expense-categories";
import { listSuppliers } from "@/lib/purchasing/suppliers";
import { guard } from "@/lib/admin/guard";
import { one, pageParams, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, dateShort } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Col } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { ExpenseCategoryFormButton, ExpenseCategoryActiveToggle, ExpenseFormButton, ExpenseWorkflowControls } from "@/components/admin/finance-forms";
import Link from "next/link";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const { page, pageSize } = pageParams(sp);
  const status = one(sp.status);
  const res = await safe("expenses", async () => {
    const [list, categories, suppliers] = await Promise.all([
      listExpenses(db, { range: r, status: status as never, page, pageSize }),
      listExpenseCategories(db),
      listSuppliers(db),
    ]);
    return { list, categories, suppliers };
  }, one(sp.fail));
  const canWrite = g.can("finance:write");

  const columns: Col<ExpenseListRow>[] = [
    { key: "expenseNumber", header: "Expense", cell: (x) => <Link href={`/admin/finance/expenses/${x.id}`} className="font-medium text-accent hover:underline">{x.expenseNumber}</Link> },
    { key: "date", header: "Date", cell: (x) => dateShort(x.expenseDate) },
    { key: "category", header: "Category", cell: (x) => x.category },
    { key: "description", header: "Description", cell: (x) => <span className="line-clamp-1">{x.description}</span>, hideBelow: "md" },
    { key: "supplier", header: "Supplier", cell: (x) => x.supplierName ?? "—", hideBelow: "lg" },
    { key: "amount", header: "Amount", cell: (x) => money(x.amountCents), align: "right" },
    { key: "status", header: "Status", cell: (x) => <StatusBadge status={x.status} />, align: "right" },
    ...(canWrite ? [{ key: "actions", header: "", cell: (x: ExpenseListRow) => <ExpenseWorkflowControls id={x.id} status={x.status} />, align: "right" as const }] : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Expenses" description={rangeLabel(parsed)} actions={canWrite && res.ok ? <ExpenseFormButton mode="create" categories={res.data.categories} suppliers={res.data.suppliers} /> : null}>
        <FinanceNav current="expenses" query={rangeQuery(parsed)} />
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load expenses." /> : (
        <>
          <div className="flex flex-wrap gap-1.5 text-[12.5px]">
            {[undefined, "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID", "CANCELLED"].map((st) => (
              <a key={st ?? "all"} href={`?${new URLSearchParams({ ...rangeQuery(parsed), ...(st ? { status: st } : {}) })}`}
                className={`rounded-md border px-2.5 py-1 font-medium ${status === st || (!status && !st) ? "border-fg bg-fg text-white" : "border-line hover:bg-canvas"}`}>
                {st ? st.charAt(0) + st.slice(1).toLowerCase().replace("_", " ") : "All"}
              </a>
            ))}
          </div>
          <Card>
            <CardBody className="p-0">
              <DataTable columns={columns} rows={res.data.list.rows} rowKey={(x) => x.id} basePath="/admin/finance/expenses" params={{ ...rangeQuery(parsed), status }}
                empty={<EmptyState title="No expenses in this period" description="Create one to get started." />} caption="Expenses" />
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-semibold">Categories</h2>{canWrite && <ExpenseCategoryFormButton />}</div>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {res.data.categories.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-md border border-line-soft px-3 py-1.5 text-[13px]">
                    <span className={c.active ? "" : "text-muted line-through"}>{c.name} <span className="text-xs text-subtle">({c.usageCount})</span></span>
                    {canWrite && <ExpenseCategoryActiveToggle id={c.id} active={c.active} />}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
