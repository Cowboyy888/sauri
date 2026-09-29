import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { route } from "@/lib/http";
import { getProductCardsByIds } from "@/lib/storefront/catalog";

/** Powers client-only lists keyed by product id (recently viewed, from localStorage) that a server
 *  component can't read directly. */
export const GET = route(async (req: Request) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 24);
  return NextResponse.json(await getProductCardsByIds(getDb(), ids));
});
