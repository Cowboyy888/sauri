import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { route } from "@/lib/http";
import { customers } from "@/lib/db/schema";
import { setConsent } from "@/lib/crm/customer-management";
import { readAttribution } from "@/lib/storefront/attribution";

const Body = z.object({ email: z.string().email() }).strict();

/** Newsletter signup reuses the `customers` table (brief: no duplicate mock systems) — the same row a
 *  shopper gets on their first order, just with marketing_opt_in set and no order history yet. */
export const POST = route(async (req: Request) => {
  const { email } = Body.parse(await req.json());
  const clean = email.trim().toLowerCase();
  const db = getDb();
  const ownHost = (await headers()).get("host")?.split(":")[0] ?? "";
  const attribution = await readAttribution(ownHost);
  const [existing] = await db.select({ id: customers.id, firstTouchSource: customers.firstTouchSource }).from(customers).where(eq(customers.email, clean));
  const touchFields = attribution ? {
    ...(!existing?.firstTouchSource ? { firstTouchSource: attribution.source, firstTouchDetails: attribution.details, firstVisitAt: new Date() } : {}),
    lastTouchSource: attribution.source, lastTouchDetails: attribution.details,
  } : {};
  const [row] = await db.insert(customers).values({ email: clean, name: clean.split("@")[0]!, ...touchFields })
    .onConflictDoUpdate({ target: customers.email, set: touchFields })
    .returning({ id: customers.id });
  await setConsent(db, row!.id, "email_marketing", true, "newsletter_signup");
  return NextResponse.json({ ok: true });
});
