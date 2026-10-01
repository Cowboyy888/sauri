/**
 * Saved, reproducible report snapshots (brief §24) — stores the already-computed `Report` (columns/rows/
 * totals from `lib/admin/reports.ts#buildReport`) so it reads back identically after later orders or
 * expenses change the live numbers.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { financialReportSnapshots } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { buildReport, type Report, type ReportKey } from "../admin/reports";
import type { Range } from "../analytics/service";
import { n, rows } from "../admin/sql";

export type SnapshotRow = typeof financialReportSnapshots.$inferSelect;

export async function saveReportSnapshot(db: Db, actor: Actor, input: { reportType: ReportKey; label: string; range: Range; filters?: Record<string, unknown> }): Promise<SnapshotRow> {
  assertCan(actor, "finance:write");
  const label = input.label.trim();
  if (!label) throw new ValidationError("Enter a name for this snapshot.");
  const report: Report = await buildReport(db, input.reportType, input.range);
  const [row] = await db.insert(financialReportSnapshots).values({
    reportType: input.reportType, label, rangeFrom: input.range.from, rangeTo: input.range.to,
    filters: input.filters ?? null, values: report, generatedByUserId: actor.userId,
  }).returning();
  await audit(db, actor, "Saved financial report snapshot", "financial_report_snapshot", row!.id, undefined, { reportType: input.reportType, label });
  return row!;
}

export type SnapshotListRow = { id: string; reportType: string; label: string; rangeFrom: Date; rangeTo: Date; generatedBy: string | null; createdAt: Date; reportVersion: number };
export async function listReportSnapshots(db: DbOrTx, opts: { reportType?: ReportKey } = {}): Promise<SnapshotListRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    select s.id, s.report_type, s.label, s.range_from, s.range_to, s.report_version, s.created_at, u.name as generated_by
    from financial_report_snapshots s left join users u on u.id = s.generated_by_user_id
    ${opts.reportType ? sql`where s.report_type = ${opts.reportType}` : sql``}
    order by s.created_at desc limit 200`);
  return res.map((x) => ({ id: x.id!, reportType: x.report_type!, label: x.label!, rangeFrom: new Date(x.range_from!), rangeTo: new Date(x.range_to!), generatedBy: x.generated_by ?? null, createdAt: new Date(x.created_at!), reportVersion: n(x.report_version) }));
}

export async function getReportSnapshot(db: DbOrTx, id: string): Promise<{ row: SnapshotListRow; report: Report } | null> {
  const [row] = await db.select().from(financialReportSnapshots).where(eq(financialReportSnapshots.id, id));
  if (!row) return null;
  return {
    row: { id: row.id, reportType: row.reportType, label: row.label, rangeFrom: row.rangeFrom, rangeTo: row.rangeTo, generatedBy: null, createdAt: row.createdAt, reportVersion: row.reportVersion },
    report: row.values as Report,
  };
}

export async function deleteReportSnapshot(db: Db, actor: Actor, id: string) {
  assertCan(actor, "finance:write");
  const [row] = await db.delete(financialReportSnapshots).where(eq(financialReportSnapshots.id, id)).returning();
  if (!row) throw new NotFoundError("Snapshot not found.");
  await audit(db, actor, "Deleted financial report snapshot", "financial_report_snapshot", id, row, undefined);
}
