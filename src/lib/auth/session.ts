/**
 * Who is calling? Resolved on the server only.
 *
 * Identity comes from Supabase Auth (the session cookie is verified with `auth.getUser()`, which checks the JWT
 * with Supabase, not just decodes it). Authorization comes from OUR `users` table: a Supabase account with no
 * active staff row has no admin access at all, and the role on that row decides what it may do.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { users } from "../db/schema";
import { BusinessError } from "../errors";
import { type Actor, type Permission, assertCan } from "./permissions";

export type Identity = { authUserId: string | null; email: string; emailVerified: boolean };
export type IdentityResolver = () => Promise<Identity | null>;

export class UnauthenticatedError extends BusinessError {
  constructor() { super("Please sign in.", "UNAUTHENTICATED", 401); }
}

let resolver: IdentityResolver = resolveSupabaseIdentity;
/** Tests and scripts only. */
export function setIdentityResolver(r: IdentityResolver) { resolver = r; }

async function resolveSupabaseIdentity(): Promise<Identity | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Local development without a Supabase project: an explicit, development-only stand-in.
    const devEmail = process.env.AUTH_DEV_STAFF_EMAIL;
    if (devEmail && process.env.NODE_ENV !== "production") return { authUserId: null, email: devEmail.toLowerCase(), emailVerified: true };
    return null;
  }
  const [{ createServerClient }, { cookies }] = await Promise.all([import("@supabase/ssr"), import("next/headers")]);
  const store = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only in Server Components; middleware refreshes */ } },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { authUserId: user.id, email: (user.email ?? "").toLowerCase(), emailVerified: !!user.email_confirmed_at };
}

/** The signed-in staff member, or null. Links a Supabase account to its staff row on first sign-in (verified email only). */
export async function getStaff(db: DbOrTx): Promise<Actor | null> {
  const id = await resolver();
  if (!id) return null;
  if (id.authUserId) {
    const [byAuth] = await db.select().from(users).where(eq(users.authUserId, id.authUserId));
    if (byAuth) return byAuth.active ? { userId: byAuth.id, name: byAuth.name, role: byAuth.role } : null;
    if (!id.emailVerified) return null;
    const [linked] = await db.update(users).set({ authUserId: id.authUserId })
      .where(and(eq(users.email, id.email), isNull(users.authUserId), eq(users.active, true))).returning();
    return linked ? { userId: linked.id, name: linked.name, role: linked.role } : null;
  }
  // Development stand-in: match by email.
  const [dev] = await db.select().from(users).where(and(eq(users.email, id.email), eq(users.active, true)));
  return dev ? { userId: dev.id, name: dev.name, role: dev.role } : null;
}

/** Use at the top of every admin route, server action and admin page. Throws 401 or 403. */
export async function requireStaff(db: DbOrTx, permission: Permission): Promise<Actor> {
  const actor = await getStaff(db);
  if (!actor) throw new UnauthenticatedError();
  assertCan(actor, permission);
  return actor;
}
