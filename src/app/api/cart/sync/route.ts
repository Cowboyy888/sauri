import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { syncAbandonedCart } from "@/lib/marketing/abandoned-carts";
import { productVariants, products } from "@/lib/db/schema";

const Body = z.object({
  lines: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10) })).max(30),
}).strict();

/** Debounced-synced from the cart provider (brief §19). A no-op for anyone not signed in — see
 *  docs/CRM.md for why anonymous cart tracking is out of scope this phase. Prices are always re-read from
 *  the database, never trusted from the client, same as every other cart-touching endpoint. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) return NextResponse.json({ ok: true });

  if (!parsed.data.lines.length) { await syncAbandonedCart(db, customer.id, []); return NextResponse.json({ ok: true }); }
  const variantIds = parsed.data.lines.map((l) => l.variantId);
  const priced = await db.select({ id: productVariants.id, priceCents: productVariants.sellingPriceCents, name: products.name })
    .from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(productVariants.id, variantIds));
  const byId = new Map(priced.map((p) => [p.id, p]));
  const items = parsed.data.lines.map((l) => {
    const p = byId.get(l.variantId);
    return p ? { variantId: l.variantId, quantity: l.quantity, unitPriceCents: p.priceCents, name: p.name } : null;
  }).filter((x): x is NonNullable<typeof x> => x != null);
  await syncAbandonedCart(db, customer.id, items);
  return NextResponse.json({ ok: true });
}
