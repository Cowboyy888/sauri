import Link from "next/link";
import { cn } from "../ui/cn";

const TABS = [
  ["overview", "Overview", "/admin/finance"], ["revenue", "Revenue", "/admin/finance/revenue"], ["expenses", "Expenses", "/admin/finance/expenses"],
  ["supplier-payments", "Supplier payments", "/admin/finance/supplier-payments"], ["customer-payments", "Customer payments", "/admin/finance/customer-payments"],
  ["refunds", "Refunds", "/admin/finance/refunds"], ["cash-flow", "Cash flow", "/admin/finance/cash-flow"], ["reconciliation", "Reconciliation", "/admin/finance/reconciliation"],
  ["reports", "Reports", "/admin/finance/reports"],
] as const;
/** Keeps the date range when switching between finance pages — same pattern as AnalyticsNav. */
export function FinanceNav({ current, query }: { current: (typeof TABS)[number][0]; query: Record<string, string> }) {
  const q = new URLSearchParams(query).toString();
  return (
    <nav aria-label="Finance" className="-mb-px flex gap-1 relative overflow-x-auto border-b border-line">
      {TABS.map(([k, l, href]) => <Link key={k} href={`${href}${q ? `?${q}` : ""}`} aria-current={current === k ? "page" : undefined} className={cn("whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted hover:text-fg", current === k && "border-fg text-fg")}>{l}</Link>)}
    </nav>
  );
}
