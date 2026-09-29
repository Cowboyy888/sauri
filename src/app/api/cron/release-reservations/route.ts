import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { releaseExpiredReservations } from "@/lib/orders/reservations";

/**
 * Safety net for abandoned checkouts (brief §30) — the webhook already releases a reservation the moment
 * Stripe reports `checkout.session.expired`; this just catches the case where that event never arrives.
 * Configured in vercel.json to run every 15 minutes. Safe to call any time, by anything, as often as you
 * like — see docs/INVENTORY_RESERVATION.md.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await releaseExpiredReservations(getDb());
  return NextResponse.json(result);
}
