import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { route } from "@/lib/http";
import { startCheckout } from "@/lib/payments/checkout";
import { readAttribution } from "@/lib/storefront/attribution";

const Address = z.object({
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), company: z.string().trim().max(120).optional(),
  line1: z.string().trim().min(1).max(200), line2: z.string().trim().max(200).optional(), city: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).optional(), postalCode: z.string().trim().min(1).max(20), country: z.string().trim().min(2).max(2),
  phone: z.string().trim().max(40).optional(),
}).strict();

// The only fields the browser may send. Prices, discounts, stock and totals are all recomputed inside
// startCheckout from the database — never trusted from here (brief §5, §29).
const Body = z.object({
  lines: z.array(z.object({
    variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10),
    personalization: z.object({ initial: z.string().max(1).optional(), engraving: z.string().max(12).optional() }).strict().optional(),
  }).strict()).min(1).max(30),
  discountCode: z.string().max(30).optional(),
  shippingMethodId: z.string().uuid(),
  customer: z.object({ email: z.string().email(), name: z.string().trim().min(1).max(160), phone: z.string().trim().max(40).optional() }).strict(),
  shippingAddress: Address,
  billingAddress: Address.optional(),
  notes: z.string().trim().max(500).optional(),
}).strict();

const clean = (a: z.infer<typeof Address>): Record<string, string> => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as Record<string, string>;

export const POST = route(async (req: Request) => {
  const input = Body.parse(await req.json());
  const ownHost = (await headers()).get("host")?.split(":")[0] ?? "";
  const attribution = await readAttribution(ownHost);
  const result = await startCheckout(getDb(), {
    ...input,
    shippingAddress: clean(input.shippingAddress),
    billingAddress: input.billingAddress ? clean(input.billingAddress) : undefined,
    acquisition: attribution ? { source: attribution.source, details: attribution.details } : undefined,
  });
  return NextResponse.json(result);
});
