import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { quoteCart } from "@/lib/orders/service";
import { BusinessError } from "@/lib/errors";

// The only fields a browser may send. Anything else (such as a price) is rejected with 400.
const Body = z.object({
  lines: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10),
    personalization: z.object({ initial: z.string().max(1).optional(), engraving: z.string().max(12).optional() }).strict().optional(),
  }).strict()).min(1).max(30),
  discountCode: z.string().max(30).optional(),
  express: z.boolean().optional(),
}).strict();

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid cart." }, { status: 400 });
  try {
    const q = await quoteCart(getDb(), { ...parsed.data, channel: "WEBSITE" });
    return NextResponse.json({
      lines: q.lines.map((l) => ({ variantId: l.variantId, sku: l.sku, name: l.productName, variant: l.snapshot.label, quantity: l.quantity, unitPriceCents: l.unitPriceCents, available: l.available })),
      subtotalCents: q.subtotalCents, discountCents: q.discountTotalCents, shippingCents: q.shippingTotalCents, taxCents: q.taxTotalCents, totalCents: q.totalCents,
      discountError: q.discountError, problems: q.problems,
    });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
