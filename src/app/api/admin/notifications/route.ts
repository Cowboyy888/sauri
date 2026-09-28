import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaff } from "@/lib/auth/session";
import { NOTIFICATION_LABEL, listNotifications, markNotificationsRead } from "@/lib/admin/misc";
import { relTime } from "@/lib/format";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const GET = route(async () => {
  const db = getDb();
  await requireStaff(db, "dashboard:read");
  const { items, unread } = await listNotifications(db, 25);
  return NextResponse.json({ unread, items: items.map((n) => ({ ...n, label: NOTIFICATION_LABEL[n.type] ?? n.type, ago: relTime(n.at) })) });
});
const Body = z.object({ ids: z.union([z.literal("all"), z.array(z.number().int().positive()).max(200)]) }).strict();
export const POST = route(async (req: Request) => {
  const db = getDb();
  await requireStaff(db, "dashboard:read");
  const { ids } = Body.parse(await req.json());
  await markNotificationsRead(db, ids);
  return NextResponse.json({ ok: true });
});
