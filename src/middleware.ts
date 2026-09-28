import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Coarse gate for /admin and /api/admin, plus Supabase session refresh.
 * This only checks that SOMEONE is signed in. Roles are checked in every route and service (requireStaff / assertCan).
 * - Supabase configured: no session → /admin/login (pages) or 401 (API).
 * - Supabase not configured: closed in production; open in development (routes still require AUTH_DEV_STAFF_EMAIL).
 */
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const isLogin = req.nextUrl.pathname === "/admin/login";
  const isEvents = req.nextUrl.pathname === "/api/admin/events";
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-sauri-path", req.nextUrl.pathname + req.nextUrl.search);
  if (!url || !anonKey) {
    if (process.env.NODE_ENV === "production") return isApi ? NextResponse.json({ error: "Not found." }, { status: 404 }) : new NextResponse("Not found", { status: 404 });
    return NextResponse.next({ request: { headers: reqHeaders } });
  }
  let res = NextResponse.next({ request: { headers: reqHeaders } });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: { headers: reqHeaders } });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !isLogin) {
    if (isApi) return NextResponse.json({ error: "Please sign in.", code: "UNAUTHENTICATED" }, { status: 401 });
    if (isEvents) return new NextResponse(null, { status: 401 });
    const to = req.nextUrl.clone(); to.pathname = "/admin/login"; to.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
