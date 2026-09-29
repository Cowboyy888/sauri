import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** A Supabase client for server actions and route handlers, where cookies can be written (unlike a Server Component). */
export async function createSupabaseActionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}
