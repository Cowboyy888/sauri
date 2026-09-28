/** Row-level security for Supabase's public API roles (anon, authenticated). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { db, pool, resetDb, makeVariant, makeStaff, TEST_URL } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { customers, products } from "@/lib/db/schema";

async function as<T>(role: "anon" | "authenticated", userId: string | null, q: string): Promise<{ rows: T[] } | { error: string }> {
  const c = new Client({ connectionString: TEST_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    if (userId) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return { rows: (await c.query(q)).rows as T[] };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}

const ANA = "00000000-0000-4000-8000-00000000000a", BEN = "00000000-0000-4000-8000-00000000000b";

describe("row-level security", () => {
  beforeEach(async () => {
    await resetDb();
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 10 });
    const draft = await makeVariant({ code: "DRF", name: "Unreleased Ring" });
    await db.update(products).set({ status: "draft" }).where(eq(products.id, draft.product.id));
    for (const [email, uid] of [["ana@example.com", ANA], ["ben@example.com", BEN]] as const) {
      await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email, name: email }, status: "paid", channel: "MANUAL_ORDER" }, staff);
      await db.update(customers).set({ userId: uid }).where(eq(customers.email, email));
    }
  });
  afterAll(() => pool.end());

  it("every table in the public schema has RLS enabled", async () => {
    const r = await db.execute(sql`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });

  it("anonymous visitors see active products only, never cost prices, orders or inventory", async () => {
    const prods = await as<{ name: string }>("anon", null, "select name from products");
    expect("rows" in prods && prods.rows.map((p) => p.name)).toEqual(["Aurora Ring"]);
    expect(await as("anon", null, "select sku, selling_price_cents from product_variants")).toHaveProperty("rows");
    for (const q of ["select cost_price_cents from product_variants", "select * from orders", "select * from inventory", "select * from users", "select * from audit_logs", "select * from variant_stock"]) {
      expect(await as("anon", null, q)).toHaveProperty("error", expect.stringMatching(/permission denied/));
    }
  });

  it("a signed-in customer sees only their own orders, and not the store's costs or margins", async () => {
    const mine = await as<{ order_number: string }>("authenticated", ANA, "select order_number from orders");
    expect("rows" in mine && mine.rows).toHaveLength(1);
    const me = await as<{ email: string }>("authenticated", ANA, "select email from customers");
    expect("rows" in me && me.rows.map((r) => r.email)).toEqual(["ana@example.com"]);
    expect(await as("authenticated", ANA, "select gross_profit_cents from orders")).toHaveProperty("error", expect.stringMatching(/permission denied/));
    expect(await as("authenticated", ANA, "select unit_cost_cents from order_items")).toHaveProperty("error", expect.stringMatching(/permission denied/));
    const items = await as("authenticated", BEN, "select product_name_snapshot, line_total_cents from order_items");
    expect("rows" in items && items.rows).toHaveLength(1);
  });

  it("a customer cannot add an address to someone else's account", async () => {
    const [ben] = await db.select().from(customers).where(eq(customers.email, "ben@example.com"));
    const r = await as("authenticated", ANA, `insert into customer_addresses (customer_id, first_name, last_name, line1, city, postal_code, country) values ('${ben!.id}', 'X', 'Y', '1 St', 'City', '000', 'KH')`);
    expect(r).toHaveProperty("error", expect.stringMatching(/row-level security/));
  });
});
