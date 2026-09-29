import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { quoteCart } from "@/lib/orders/service";
import { BusinessError } from "@/lib/errors";
import { getProductCardsByIds, getVariantImages } from "@/lib/storefront/catalog";

// The only fields a browser may send. Anything else (such as a price) is rejected with 400.
const Body = z.object({
  lines: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10),
    personalization: z.object({ initial: z.string().max(1).optional(), engraving: z.string().max(12).optional() }).strict().optional(),
  }).strict()).min(1).max(30),
  discountCode: z.string().max(30).optional(),
  express: z.boolean().optional(),
  shippingMethodId: z.string().uuid().optional(),
}).strict();

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid cart." }, { status: 400 });
  try {
    const db = getDb();
    const q = await quoteCart(db, { ...parsed.data, channel: "WEBSITE" });
    const [products, variantImages] = await Promise.all([
      getProductCardsByIds(db, [...new Set(q.lines.map((l) => l.productId))]).then((rows) => new Map(rows.map((p) => [p.id, p]))),
      getVariantImages(db, q.lines.map((l) => l.variantId)),
    ]);
    return NextResponse.json({
      lines: q.lines.map((l, i) => {
        const p = products.get(l.productId);
        return {
          variantId: l.variantId, productId: l.productId, slug: p?.slug ?? null, sku: l.sku, name: l.productName, variant: l.snapshot.label,
          quantity: l.quantity, unitPriceCents: l.unitPriceCents, lineTotalCents: q.lineAmounts[i]!.lineTotalCents, available: l.available,
          image: variantImages.get(l.variantId) ?? p?.image ?? null,
        };
      }),
      subtotalCents: q.subtotalCents, discountCents: q.discountTotalCents, shippingCents: q.shippingTotalCents, taxCents: q.taxTotalCents, totalCents: q.totalCents,
      discountError: q.discountError, problems: q.problems,
    });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
