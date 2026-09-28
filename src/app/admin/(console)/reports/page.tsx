import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { REPORT_KEYS, REPORT_META, buildReport, type ReportKey } from "@/lib/admin/reports";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateShort, int, money, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, EmptyState } from "@/components/admin/states";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("reports:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, parsed = parseRange(sp), q = new URLSearchParams(rangeQuery(parsed));
  const preview = REPORT_KEYS.includes(one(sp.preview) as ReportKey) ? (one(sp.preview) as ReportKey) : null;
  const href = (k: string, f: string) => `/api/admin/reports/${k}?${new URLSearchParams([...q, ["format", f]])}`;
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Reports" description={`Exports use the date range above: ${rangeLabel(parsed)}. Inventory and low-stock reports are a snapshot as of now.`} />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORT_KEYS.map((k) => (
          <li key={k} className={cn("grid gap-2 rounded-lg border border-line bg-surface p-4", preview === k && "border-accent")}>
            <div><p className="text-[14px] font-semibold">{REPORT_META[k].title}</p><p className="mt-0.5 text-xs text-muted">{REPORT_META[k].description}</p></div>
            <div className="flex flex-wrap gap-1.5 text-[12.5px]">
              <a href={`?${new URLSearchParams([...q, ["preview", k]])}#preview`} className="rounded-md border border-line px-2.5 py-1 font-medium hover:bg-canvas">Preview</a>
              {(["csv", "xlsx", "pdf"] as const).map((f) => <a key={f} href={href(k, f)} download className="rounded-md border border-line px-2.5 py-1 font-medium text-accent hover:bg-accent-soft">{f === "xlsx" ? "Excel" : f.toUpperCase()}</a>)}
            </div>
          </li>
        ))}
      </ul>
      {preview && <Preview k={preview} sp={sp} />}
    </div>
  );
}

async function Preview({ k, sp }: { k: ReportKey; sp: SearchParams }) {
  const db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("report", () => buildReport(db, k, r), one(sp.fail));
  if (!res.ok) return <Card><ErrorState message="Unable to build this report." /></Card>;
  const rep = res.data, shown = rep.rows.slice(0, 100);
  const cell = (v: unknown, t: string) => v == null ? "" : t === "money" ? money(Math.round(Number(v) * 100)) : t === "pct" ? pct(Number(v)) : t === "int" ? int(Number(v)) : t === "date" || t === "datetime" ? dateShort(String(v)) : String(v);
  return (
    <Card id="preview">
      <CardHeader title={`${rep.title} · preview`} description={`${rep.dateBound ? rangeLabel(parsed) : "Snapshot as of now"} · ${int(rep.rows.length)} rows${rep.rows.length > 100 ? ", first 100 shown; exports include all rows" : ""}`} />
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
