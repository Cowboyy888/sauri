import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { restock } from "@/lib/inventory/service";
import { route } from "@/lib/http";

const Body = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().positive().max(100_000),
  unitCostCents: z.number().int().min(0).optional(),
  supplierName: z.string().trim().min(1).max(120).optional(),
  reference: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
}).strict();

export const POST = route(async (req: Request) => {
  const db = getDb();
  const actor = await requireStaff(db, "inventory:write");
  const body = Body.parse(await req.json());
  return NextResponse.json(await restock(db, actor, body));
});
