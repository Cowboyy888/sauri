import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { route } from "@/lib/http";
import { getCustomer } from "@/lib/customer/session";
import { addToWishlist, getWishlistProductIds, removeFromWishlist } from "@/lib/storefront/wishlist";

const Body = z.object({ productId: z.string().uuid() }).strict();

export const GET = route(async () => {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) return NextResponse.json({ signedIn: false, productIds: [] });
  return NextResponse.json({ signedIn: true, productIds: await getWishlistProductIds(db, customer.id) });
});

export const POST = route(async (req: Request) => {
  const { productId } = Body.parse(await req.json());
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) return NextResponse.json({ error: "Please sign in to save items.", code: "UNAUTHENTICATED" }, { status: 401 });
  await addToWishlist(db, customer.id, productId);
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (req: Request) => {
  const { productId } = Body.parse(await req.json());
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) return NextResponse.json({ error: "Please sign in to save items.", code: "UNAUTHENTICATED" }, { status: 401 });
  await removeFromWishlist(db, customer.id, productId);
  return NextResponse.json({ ok: true });
});
