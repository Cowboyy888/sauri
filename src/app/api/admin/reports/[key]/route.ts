import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { resolveRange } from "@/lib/analytics/service";
import { parseRange, rangeLabel } from "@/lib/admin/range";
import { REPORT_KEYS, buildReport, toCsv, toPdf, toXlsx, type ReportKey } from "@/lib/admin/reports";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" } as const;

export const GET = route(async (req: Request, ctx: { params: Promise<{ key: string }> }) => {
  const db = getDb();
  await requireStaff(db, "reports:read");
  const { key } = await ctx.params;
  if (!REPORT_KEYS.includes(key as ReportKey)) return NextResponse.json({ error: "Unknown report.", code: "NOT_FOUND" }, { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const format = (sp.format ?? "csv") as keyof typeof TYPES;
  if (!(format in TYPES)) return NextResponse.json({ error: "Format must be csv, xlsx or pdf.", code: "VALIDATION" }, { status: 400 });
  const parsed = parseRange(sp);
  const r = await resolveRange(db, parsed.key, parsed.custom);
  const rep = await buildReport(db, key as ReportKey, r);
  const stamp = parsed.custom ? `${parsed.custom.from}_${parsed.custom.to}` : `${parsed.key}_${new Date().toISOString().slice(0, 10)}`;
  const filename = `sauri-${key}-${rep.dateBound ? stamp : new Date().toISOString().slice(0, 10)}.${format}`;
  const body = format === "csv" ? new TextEncoder().encode(toCsv(rep)) : format === "xlsx" ? await toXlsx(rep, rangeLabel(parsed)) : await toPdf(rep, rangeLabel(parsed));
  return new Response(body as unknown as BodyInit, { headers: { "content-type": TYPES[format], "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
});
