import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export async function GET() {
  await getDb().execute(sql`select 1`);
  return NextResponse.json({ ok: true });
}
