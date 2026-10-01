/** Authorization is enforced on the server: calling an admin API directly with the wrong role must fail. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { setIdentityResolver, getStaff } from "@/lib/auth/session";
import { PERMISSIONS, can } from "@/lib/auth/permissions";
import { placeOrder } from "@/lib/orders/service";
import { restock } from "@/lib/inventory/service";
import { users } from "@/lib/db/schema";
import { POST as restockRoute } from "@/app/api/admin/inventory/restock/route";
import { POST as statusRoute } from "@/app/api/admin/orders/[id]/status/route";
import { GET as summaryRoute } from "@/app/api/admin/analytics/summary/route";

const AUTH_IDS = { OWNER: "00000000-0000-4000-8000-000000000001", SALES: "00000000-0000-4000-8000-000000000002", INVENTORY: "00000000-0000-4000-8000-000000000003", VIEWER: "00000000-0000-4000-8000-000000000004" };
const signIn = (authUserId: string | null, email = "x@sauri.test", emailVerified = true) => setIdentityResolver(async () => (authUserId || email ? { authUserId, email, emailVerified } : null));
const signOut = () => setIdentityResolver(async () => null);
const json = (body: unknown) => new Request("http://test/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("server-side authorization", () => {
  beforeEach(async () => {
    await resetDb();
    for (const [role, id] of Object.entries(AUTH_IDS)) await makeStaff(role as keyof typeof AUTH_IDS, { authUserId: id });
  });
  afterAll(async () => { await pool.end(); await (globalThis as { sauriPool?: { end(): Promise<void> } }).sauriPool?.end(); });

  it("unauthenticated calls get 401", async () => {
    signOut();
    const { variant } = await makeVariant();
    expect((await restockRoute(json({ variantId: variant.id, quantity: 5 }))).status).toBe(401);
    expect((await summaryRoute(new Request("http://test/api?range=30d"))).status).toBe(401);
  });

  it("an INVENTORY user cannot change order status by calling the API directly (403); SALES can", async () => {
    const owner = { userId: null, name: "seed", role: "OWNER" as const };
    const { variant } = await makeVariant();
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    const call = () => statusRoute(json({ status: "processing" }), { params: Promise.resolve({ id: o.id }) });
    signIn(AUTH_IDS.INVENTORY);
    const denied = await call();
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("FORBIDDEN");
    signIn(AUTH_IDS.SALES);
    expect((await call()).status).toBe(200);
  });

  it("restock: INVENTORY allowed, VIEWER and SALES forbidden, invalid bodies rejected", async () => {
    const { variant } = await makeVariant({ stock: 1 });
    signIn(AUTH_IDS.VIEWER);
    expect((await restockRoute(json({ variantId: variant.id, quantity: 5 }))).status).toBe(403);
    signIn(AUTH_IDS.SALES);
    expect((await restockRoute(json({ variantId: variant.id, quantity: 5 }))).status).toBe(403);
    signIn(AUTH_IDS.INVENTORY);
    expect((await restockRoute(json({ variantId: variant.id, quantity: -5 }))).status).toBe(400);
    expect((await restockRoute(json({ variantId: variant.id, quantity: 5, costOverride: 1 }))).status).toBe(400);
    const ok = await restockRoute(json({ variantId: variant.id, quantity: 5 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ stockBefore: 1, stockAfter: 6 });
  });

  it("VIEWER can read the dashboard summary", async () => {
    signIn(AUTH_IDS.VIEWER);
    const res = await summaryRoute(new Request("http://test/api?range=7d"));
    expect(res.status).toBe(200);
    expect((await res.json()).current).toHaveProperty("grossProfitCents");
  });

  it("services check roles too, even if a route forgot to", async () => {
    const { variant } = await makeVariant();
    await expect(restock(db, { userId: null, name: "sales", role: "SALES" }, { variantId: variant.id, quantity: 1 })).rejects.toThrow(/cannot perform inventory:write/);
  });

  it("a Supabase account with no staff row, or a deactivated one, has no access", async () => {
    signIn("00000000-0000-4000-8000-0000000000ff", "stranger@example.com");
    expect(await getStaff(db)).toBeNull();
    await db.update(users).set({ active: false }).where(eq(users.authUserId, AUTH_IDS.SALES));
    signIn(AUTH_IDS.SALES);
    expect(await getStaff(db)).toBeNull();
  });

  it("first sign-in links a Supabase account to its staff row by VERIFIED email only", async () => {
    await makeStaff("ADMIN", { email: "dara@sauri.test" });
    signIn("00000000-0000-4000-8000-0000000000aa", "dara@sauri.test", false);
    expect(await getStaff(db)).toBeNull();
    signIn("00000000-0000-4000-8000-0000000000aa", "dara@sauri.test", true);
    expect(await getStaff(db)).toMatchObject({ role: "ADMIN" });
    const [u] = await db.select().from(users).where(eq(users.email, "dara@sauri.test"));
    expect(u!.authUserId).toBe("00000000-0000-4000-8000-0000000000aa");
  });

  it("permission matrix matches the brief", () => {
    expect([...PERMISSIONS.OWNER].length).toBeGreaterThan([...PERMISSIONS.ADMIN].length);
    expect(can("ADMIN", "staff:write")).toBe(false);
    expect(can("ADMIN", "settings:write")).toBe(false);
    for (const p of ["products:write", "orders:write", "customers:write", "inventory:write", "sales:read", "reports:read"] as const) expect(can("ADMIN", p)).toBe(true);
    expect([...PERMISSIONS.SALES].sort()).toEqual(["customers:read", "customers:write", "dashboard:read", "loyalty:read", "marketing:read", "orders:read", "orders:write", "purchasing:read", "sales:read"]);
    expect([...PERMISSIONS.INVENTORY].sort()).toEqual(["dashboard:read", "inventory:read", "inventory:write", "products:read", "products:write", "purchasing:read"]);
    expect([...PERMISSIONS.VIEWER].sort()).toEqual(["dashboard:read", "marketing:read", "purchasing:read"]);
    expect(can("ADMIN", "marketing:write")).toBe(true);
    expect(can("ADMIN", "purchasing:write")).toBe(true);
    expect(can("INVENTORY", "purchasing:write")).toBe(false);
    expect(can("SALES", "purchasing:write")).toBe(false);
  });
});
