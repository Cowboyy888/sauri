import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { route } from "@/lib/http";
import { searchProducts } from "@/lib/storefront/catalog";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const result = await searchProducts(getDb(), q, 8);
  return NextResponse.json(result);
});
