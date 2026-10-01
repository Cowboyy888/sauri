import Link from "next/link";
import { cn } from "../ui/cn";

const TABS = [["sales", "Sales"], ["products", "Products"], ["collections", "Collections"], ["customers", "Customers"], ["channels", "Channels"], ["marketing", "Marketing"], ["funnel", "Funnel"], ["search", "Search"], ["shipping", "Shipping"], ["returns", "Returns"], ["suppliers", "Suppliers"], ["purchases", "Purchases"]] as const;
/** Keeps the date range when switching between analytics pages. */
export function AnalyticsNav({ current, query }: { current: (typeof TABS)[number][0]; query: Record<string, string> }) {
  const q = new URLSearchParams(query).toString();
  return (
    <nav aria-label="Analytics" className="-mb-px flex gap-1 relative overflow-x-auto border-b border-line">
      {TABS.map(([k, l]) => <Link key={k} href={`/admin/analytics/${k}${q ? `?${q}` : ""}`} aria-current={current === k ? "page" : undefined} className={cn("whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted hover:text-fg", current === k && "border-fg text-fg")}>{l}</Link>)}
    </nav>
  );
}
