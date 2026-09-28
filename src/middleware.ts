import { NextResponse, type NextRequest } from "next/server";

/**
 * TEMPORARY admin guard until staff login (phase 3).
 * - Production: /admin requires ADMIN_BASIC_AUTH ("user:password"); if it is not set, /admin is closed.
 * - Development: open, so you can work locally.
 * Real per-user auth + role checks replace this; services already enforce roles via assertCan().
 */
export function middleware(req: NextRequest) {
  const creds = process.env.ADMIN_BASIC_AUTH;
  if (process.env.NODE_ENV !== "production" && !creds) return NextResponse.next();
  if (!creds) return new NextResponse("Not found", { status: 404 });
  const header = req.headers.get("authorization") ?? "";
  const [scheme, value] = header.split(" ");
  if (scheme === "Basic" && value && atob(value) === creds) return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="SAURI admin"' } });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
