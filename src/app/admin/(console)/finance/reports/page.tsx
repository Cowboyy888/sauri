import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { REPORT_META, buildReport, type ReportKey } from "@/lib/admin/reports";
import { listReportSnapshots } from "@/lib/finance/snapshots";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateShort, int, money, pct, dateTimeFull } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { FinanceNav } from "@/components/admin/finance-nav";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, EmptyState } from "@/components/admin/states";
import { cn } from "@/components/ui/cn";
import { SaveSnapshotButton } from "@/components/admin/finance-forms";
import Link from "next/link";

export const metadata = { title: "Finance reports" };

/** The brief's 14 named business reports, mapped onto the shared report engine (docs/FINANCE_AUDIT.md).
 *  A few deliberately point at the same key as another named report where the existing definition already
 *  covers it (COGS/Gross Profit both live inside "profit"), so nothing is computed twice. */
const FINANCE_REPORTS: { label: string; key: ReportKey }[] = [
  { label: "1. Management P&L", key: "management-pl" },
  { label: "2. Revenue Report", key: "daily-sales" },
  { label: "3. COGS Report", key: "profit" },
  { label: "4. Gross Profit Report", key: "profit" },
  { label: "5. Expense Report", key: "expenses" },
  { label: "6. Cash Flow Report", key: "cash-flow" },
  { label: "7. Customer Payment Report", key: "customer-payments" },
  { label: "8. Supplier Payment Report", key: "supplier-payments" },
  { label: "9. Refund Report", key: "refunds" },
  { label: "10. Tax Summary", key: "tax-summary" },
  { label: "11. Inventory Valuation Report", key: "inventory" },
  { label: "12. Purchase Report", key: "purchases" },
  { label: "13. Product Profitability Report", key: "product-profitability" },
  { label: "14. Sales Channel Report", key: "sales-channel" },
];

export default async function FinanceReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const q = new URLSearchParams(rangeQuery(parsed));
  const preview = FINANCE_REPORTS.some((x) => x.key === one(sp.preview)) ? (one(sp.preview) as ReportKey) : null;
  const href = (k: string, f: string) => `/api/admin/reports/${k}?${new URLSearchParams([...q, ["format", f]])}`;
  const snapshots = await safe("snapshots", () => listReportSnapshots(db));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Finance reports" description={`Exports use the date range above: ${rangeLabel(parsed)}.`}>
        <FinanceNav current="reports" query={rangeQuery(parsed)} />
      </PageHeader>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FINANCE_REPORTS.map(({ label, key }) => (
          <li key={label} className={cn("grid gap-2 rounded-lg border border-line bg-surface p-4", preview === key && "border-accent")}>
            <div><p className="text-[14px] font-semibold">{label}</p><p className="mt-0.5 text-xs text-muted">{REPORT_META[key].description}</p></div>
            <div className="flex flex-wrap gap-1.5 text-[12.5px]">
              <a href={`?${new URLSearchParams([...q, ["preview", key]])}#preview`} className="rounded-md border border-line px-2.5 py-1 font-medium hover:bg-canvas">Preview</a>
              {(["csv", "xlsx", "pdf"] as const).map((f) => <a key={f} href={href(key, f)} download className="rounded-md border border-line px-2.5 py-1 font-medium text-accent hover:bg-accent-soft">{f === "xlsx" ? "Excel" : f.toUpperCase()}</a>)}
            </div>
          </li>
        ))}
      </ul>
      {preview && <Preview k={preview} sp={sp} from={r.from.toISOString()} to={r.to.toISOString()} canWrite={g.can("finance:write")} />}
      <Card>
        <CardHeader title="Saved snapshots" description="Reproducible copies of a generated report, saved by name (brief §24)." />
        {!snapshots.ok || snapshots.data.length === 0 ? <EmptyState title="No snapshots saved yet" /> : (
          <ul className="grid grid-cols-1 gap-1.5 p-4 pt-0">
            {snapshots.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-md border border-line-soft px-3 py-2 text-[13px]">
                <div><Link href={`/admin/finance/reports/snapshots/${s.id}`} className="font-medium text-accent hover:underline">{s.label}</Link><p className="text-xs text-muted">{REPORT_META[s.reportType as ReportKey]?.title ?? s.reportType} · {dateShort(s.rangeFrom)}–{dateShort(s.rangeTo)} · saved {dateTimeFull(s.createdAt)}{s.generatedBy ? ` by ${s.generatedBy}` : ""}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function Preview({ k, sp, from, to, canWrite }: { k: ReportKey; sp: SearchParams; from: string; to: string; canWrite: boolean }) {
  const db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("report", () => buildReport(db, k, r), one(sp.fail));
  if (!res.ok) return <Card><ErrorState message="Unable to build this report." /></Card>;
  const rep = res.data, shown = rep.rows.slice(0, 100);
  const cell = (v: unknown, t: string) => v == null ? "" : t === "money" ? money(Math.round(Number(v) * 100)) : t === "pct" ? pct(Number(v)) : t === "int" ? int(Number(v)) : t === "date" || t === "datetime" ? dateShort(String(v)) : String(v);
  return (
    <Card id="preview">
      <CardHeader title={`${rep.title} · preview`} description={`${rep.dateBound ? rangeLabel(parsed) : "Snapshot as of now"} · ${int(rep.rows.length)} rows${rep.rows.length > 100 ? ", first 100 shown; exports include all rows" : ""}`}
        actions={canWrite ? <SaveSnapshotButton reportType={k} from={from} to={to} /> : undefined} />
      {!shown.length ? <EmptyState title="No rows for this period" /> : (
        <div className="max-h-[560px] overflow-auto"><table className="w-full text-[12.5px]"><caption className="sr-only">{rep.title}</caption>
          <thead className="sticky top-0 bg-surface"><tr className="border-b border-line">{rep.columns.map((c) => <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted first:pl-4", c.type !== "text" && c.type !== "date" && c.type !== "datetime" && "text-right")}>{c.label}</th>)}</tr></thead>
          <tbody>{shown.map((row, i) => <tr key={i} className="border-b border-line-soft">{rep.columns.map((c) => <td key={c.key} className={cn("whitespace-nowrap px-3 py-1.5 first:pl-4", c.type !== "text" && c.type !== "date" && c.type !== "datetime" && "num")}>{cell(row[c.key], c.type)}</td>)}</tr>)}
            {rep.totals && <tr className="font-semibold">{rep.columns.map((c, i) => <td key={c.key} className={cn("px-3 py-2 first:pl-4", i && "num")}>{i === 0 ? "Total" : rep.totals![c.key] != null ? cell(rep.totals![c.key], c.type) : ""}</td>)}</tr>}
          </tbody></table></div>
      )}
    </Card>
  );
}
