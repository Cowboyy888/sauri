import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { updateOrderStatus } from "@/lib/orders/service";
import { route } from "@/lib/http";

const Body = z.object({
  status: z.enum(["processing", "shipped", "delivered", "cancelled", "refunded"]),
  reason: z.string().trim().max(500).optional(),
  restock: z.boolean().optional(),
}).strict();

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb();
  const actor = await requireStaff(db, "orders:write");
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Order not found.", code: "NOT_FOUND" }, { status: 404 });
  const body = Body.parse(await req.json());
  await updateOrderStatus(db, actor, id, body.status, { reason: body.reason, restock: body.restock });
  return NextResponse.json({ ok: true });
});
