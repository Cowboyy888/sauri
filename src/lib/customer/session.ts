/**
 * Who is shopping? Separate from staff (lib/auth/session.ts). A shopper's identity comes from the same
 * Supabase Auth project; a `customers` row is linked by `user_id` once they sign in, and created on demand
 * for a first-time signed-in visitor (guests who only check out never get a customer session at all).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { customers } from "../db/schema";
import { devAuthEnabled, getIdentity, type Identity } from "../auth/session";

export type CustomerSession = { id: string; email: string; name: string; phone: string | null; marketingOptIn: boolean };

/** Local development only, no Supabase project configured: a cookie stands in for a signed-in shopper. */
export const CUSTOMER_DEV_COOKIE = "sauri_dev_customer";

async function resolveIdentity(): Promise<Identity | null> {
  if (devAuthEnabled()) {
    const { cookies } = await import("next/headers");
    const email = (await cookies()).get(CUSTOMER_DEV_COOKIE)?.value?.toLowerCase();
    return email ? { authUserId: null, email, emailVerified: true } : null;
  }
  return getIdentity();
}

/** The signed-in shopper's customer row, or null if nobody is signed in. Links or creates the row on first visit. */
export async function getCustomer(db: DbOrTx): Promise<CustomerSession | null> {
  const id = await resolveIdentity();
  if (!id || !id.email) return null;

  if (id.authUserId) {
    const [byAuth] = await db.select().from(customers).where(eq(customers.userId, id.authUserId));
    if (byAuth) return byAuth;
    if (!id.emailVerified) return null;
    // Link an existing guest customer row (same email, no account yet) on first verified sign-in.
    const [linked] = await db.update(customers).set({ userId: id.authUserId })
      .where(and(eq(customers.email, id.email), isNull(customers.userId))).returning();
    if (linked) return linked;
    // First-ever sign-in with no prior order history: create the row now.
    const [created] = await db.insert(customers).values({ userId: id.authUserId, email: id.email, name: id.email.split("@")[0]! })
      .onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await db.select().from(customers).where(eq(customers.email, id.email));
    return existing ?? null;
  }
  // Development stand-in (no Supabase project configured): match or create by email, no auth link.
  const [dev] = await db.select().from(customers).where(eq(customers.email, id.email));
  if (dev) return dev;
  const [created] = await db.insert(customers).values({ email: id.email, name: id.email.split("@")[0]! }).onConflictDoNothing().returning();
  return created ?? null;
}

/** Use at the top of a page or route that requires a signed-in shopper. */
export async function requireCustomer(db: Db): Promise<CustomerSession> {
  const customer = await getCustomer(db);
  if (!customer) throw new Error("Please sign in.");
  return customer;
}
