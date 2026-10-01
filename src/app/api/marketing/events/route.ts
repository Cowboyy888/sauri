import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { route } from "@/lib/http";
import { getCustomer } from "@/lib/customer/session";
import { classifyDevice, recordEvents, type ClientEvent } from "@/lib/marketing/events";

const Event = z.object({
  eventId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(200),
  type: z.enum([
    "page_view", "product_viewed", "collection_viewed", "search", "wishlist_added", "cart_added", "cart_removed",
    "checkout_started", "shipping_added", "payment_started", "purchase_completed", "coupon_applied", "coupon_failed",
    "promotion_viewed", "email_clicked",
  ]),
  path: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  utmSource: z.string().max(200).optional(), utmMedium: z.string().max(200).optional(), utmCampaign: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(), utmContent: z.string().max(200).optional(),
  productId: z.string().uuid().optional(), collectionId: z.string().uuid().optional(),
  searchQuery: z.string().max(200).optional(), resultsCount: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const Body = z.object({ events: z.array(Event).min(1).max(25) }).strict();

/** Fire-and-forget client analytics (brief §46, §49). Never blocks: a malformed batch is just dropped, not
 *  a 400 that could surface an error to a shopper for something that isn't their action failing. */
export const POST = route(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true });
  const db = getDb();
  const customer = await getCustomer(db);
  const device = classifyDevice(req.headers.get("user-agent"));
  await recordEvents(db, parsed.data.events as ClientEvent[], { customerId: customer?.id ?? null, device }).catch((e) => console.error("[marketing:events]", e));
  return NextResponse.json({ ok: true });
});
