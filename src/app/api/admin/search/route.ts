import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { globalSearch } from "@/lib/admin/misc";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
/** Results are limited to what the caller's role may open. */
export const GET = route(async (req: Request) => {
  const db = getDb();
  const staff = await requireStaff(db, "dashboard:read");
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  const hits = await globalSearch(db, q, { orders: can(staff.role, "orders:read"), products: can(staff.role, "products:read"), customers: can(staff.role, "customers:read") });
  return NextResponse.json({ hits });
});
