import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getReportSnapshot } from "@/lib/finance/snapshots";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { dateShort, dateTimeFull, int, money, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/states";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Report snapshot" };

export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const { id } = await params, db = getDb();
  const res = await safe("snapshot", () => getReportSnapshot(db, id));
  if (!res.ok) return <EmptyState title="Unable to load this snapshot." />;
  if (!res.data) notFound();
  const { row, report: rep } = res.data;
  const cell = (v: unknown, t: string) => v == null ? "" : t === "money" ? money(Math.round(Number(v) * 100)) : t === "pct" ? pct(Number(v)) : t === "int" ? int(Number(v)) : t === "date" || t === "datetime" ? dateShort(String(v)) : String(v);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title={row.label} description={`Saved snapshot · ${rep.title} · ${dateShort(row.rangeFrom)}–${dateShort(row.rangeTo)} · saved ${dateTimeFull(row.createdAt)} · version ${row.reportVersion}`} />
      <p className="text-xs text-subtle">This is the exact report as generated at save time — it does not update as later orders or expenses change the live numbers.</p>
      <Card>
        <CardHeader title={rep.title} description={rep.description} />
        <div className="max-h-[560px] overflow-auto"><table className="w-full text-[12.5px]"><caption className="sr-only">{rep.title}</caption>
          <thead className="sticky top-0 bg-surface"><tr className="border-b border-line">{rep.columns.map((c) => <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted first:pl-4", c.type !== "text" && c.type !== "date" && c.type !== "datetime" && "text-right")}>{c.label}</th>)}</tr></thead>
          <tbody>{rep.rows.map((row2, i) => <tr key={i} className="border-b border-line-soft">{rep.columns.map((c) => <td key={c.key} className={cn("whitespace-nowrap px-3 py-1.5 first:pl-4", c.type !== "text" && c.type !== "date" && c.type !== "datetime" && "num")}>{cell(row2[c.key], c.type)}</td>)}</tr>)}
            {rep.totals && <tr className="font-semibold">{rep.columns.map((c, i) => <td key={c.key} className={cn("px-3 py-2 first:pl-4", i && "num")}>{i === 0 ? "Total" : rep.totals![c.key] != null ? cell(rep.totals![c.key], c.type) : ""}</td>)}</tr>}
          </tbody></table></div>
      </Card>
    </div>
  );
}
