import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { getMetrics, resolveRange } from "@/lib/analytics/service";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
const Query = z.object({
  range: z.enum(["today", "yesterday", "7d", "30d", "90d", "ytd", "all", "custom"]).default("30d"),
  from: z.string().optional(), to: z.string().optional(),
});

export const GET = route(async (req: Request) => {
  const db = getDb();
  await requireStaff(db, "dashboard:read");
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const r = await resolveRange(db, q.range, q.from && q.to ? { from: q.from, to: q.to } : undefined);
  const [current, previous] = await Promise.all([getMetrics(db, r), getMetrics(db, r.previous)]);
  return NextResponse.json({ range: { key: r.key, from: r.from, to: r.to }, current, previous });
});
