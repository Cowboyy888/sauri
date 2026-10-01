import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getFinancialSummary } from "@/lib/finance/summary";
import { getExpensesByCategory } from "@/lib/finance/expenses";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, pctChange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/states";
import { cn } from "@/components/ui/cn";
import Link from "next/link";

export const metadata = { title: "Management P&L" };

type Line = { label: string; amount: number; indent?: boolean; bold?: boolean; divider?: boolean };
type Summary = Awaited<ReturnType<typeof getFinancialSummary>>;
type ByCategory = Awaited<ReturnType<typeof getExpensesByCategory>>;

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("profit-loss", async () => {
    const [cur, prev, curByCat, prevByCat] = await Promise.all([getFinancialSummary(db, r), getFinancialSummary(db, r.previous), getExpensesByCategory(db, r), getExpensesByCategory(db, r.previous)]);
    return { cur, prev, curByCat, prevByCat };
  }, one(sp.fail));

  const buildLines = (s: { cur: Summary; prev: Summary; curByCat: ByCategory; prevByCat: ByCategory }): { cur: Line[]; prev: Line[] } => {
    const catNames = [...new Set([...s.curByCat.map((c) => c.category), ...s.prevByCat.map((c) => c.category)])];
    const curCat = new Map(s.curByCat.map((c) => [c.category, c.totalCents]));
    const prevCat = new Map(s.prevByCat.map((c) => [c.category, c.totalCents]));
    const cur: Line[] = [
      { label: "REVENUE", amount: NaN, bold: true }, { label: "Gross sales", amount: s.cur.grossSalesCents, indent: true },
      { label: "Discounts", amount: -s.cur.discountCents, indent: true }, { label: "Refunds", amount: -s.cur.refundCents, indent: true },
      { label: "Net revenue", amount: s.cur.netRevenueCents, bold: true, divider: true },
      { label: "COST OF GOODS SOLD", amount: NaN, bold: true }, { label: "COGS", amount: -s.cur.cogsCents, indent: true },
      { label: "Gross profit", amount: s.cur.grossProfitCents, bold: true, divider: true },
      { label: "OPERATING EXPENSES", amount: NaN, bold: true },
      ...catNames.map((c) => ({ label: c, amount: -(curCat.get(c) ?? 0), indent: true })),
      { label: "Total operating expenses", amount: -s.cur.operatingExpensesCents, indent: true },
      { label: "Operating profit", amount: s.cur.operatingProfitCents, bold: true, divider: true },
    ];
    const prev: Line[] = [
      { label: "REVENUE", amount: NaN }, { label: "Gross sales", amount: s.prev.grossSalesCents },
      { label: "Discounts", amount: -s.prev.discountCents }, { label: "Refunds", amount: -s.prev.refundCents },
      { label: "Net revenue", amount: s.prev.netRevenueCents },
      { label: "COST OF GOODS SOLD", amount: NaN }, { label: "COGS", amount: -s.prev.cogsCents },
      { label: "Gross profit", amount: s.prev.grossProfitCents },
      { label: "OPERATING EXPENSES", amount: NaN },
      ...catNames.map((c) => ({ label: c, amount: -(prevCat.get(c) ?? 0) })),
      { label: "Total operating expenses", amount: -s.prev.operatingExpensesCents },
      { label: "Operating profit", amount: s.prev.operatingProfitCents },
    ];
    return { cur, prev };
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Management P&L" description={`${rangeLabel(parsed)} · an operational statement — not a certified accounting statement.`}>
        <Link href={`/admin/finance/reports?${new URLSearchParams(rangeQuery(parsed))}`} className="text-[13px] font-medium text-accent hover:underline">← All reports</Link>
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load the P&L." /> : (() => {
        const { cur, prev } = buildLines(res.data);
        const netRevenue = res.data.cur.netRevenueCents;
        return (
          <Card>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full text-[13px]"><caption className="sr-only">Management P&L</caption>
                <thead><tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2">Line</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">% of revenue</th>
                  <th className="px-3 py-2 text-right">Previous period</th><th className="px-3 py-2 text-right">Change</th><th className="px-3 py-2 text-right">Change %</th>
                </tr></thead>
                <tbody>
                  {cur.map((l, i) => {
                    const p = prev[i]!;
                    const isHeader = Number.isNaN(l.amount);
                    const change = pctChange(l.amount, p.amount);
                    return (
                      <tr key={i} className={cn("border-b border-line-soft", l.divider && "border-b-2 border-line", l.bold && !isHeader && "font-semibold")}>
                        <td className={cn("px-4 py-1.5", isHeader && "pt-3 text-xs font-semibold uppercase tracking-wide text-muted", l.indent && "pl-8")}>{l.label}</td>
                        {isHeader ? <td colSpan={5} /> : <>
                          <td className="px-3 py-1.5 text-right num">{money(l.amount)}</td>
                          <td className="px-3 py-1.5 text-right num">{netRevenue ? pct((l.amount / netRevenue) * 100) : "N/A"}</td>
                          <td className="px-3 py-1.5 text-right num">{money(p.amount)}</td>
                          <td className="px-3 py-1.5 text-right num">{money(l.amount - p.amount)}</td>
                          <td className="px-3 py-1.5 text-right num">{change == null ? "N/A" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}</td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>
        );
      })()}
    </div>
  );
}
