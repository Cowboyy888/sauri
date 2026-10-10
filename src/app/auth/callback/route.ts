import { NextResponse } from "next/server";
import { createSupabaseActionClient } from "@/lib/supabase/server";

/** Supabase redirects here after a magic-link or password-reset click, with a one-time `code` to exchange for a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/account";
  // Same-origin paths only: "//evil.com" and "https://…" would otherwise turn this into an open redirect.
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/account";
  const supabase = code ? await createSupabaseActionClient() : null;
  if (supabase) await supabase.auth.exchangeCodeForSession(code!);
  return NextResponse.redirect(new URL(next, url.origin));
}
