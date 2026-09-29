/** Back-in-stock notifications and abandoned-cart tracking (brief §19, §40, §45). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff } from "./helpers";
import { adjustStock, restock } from "@/lib/inventory/service";
import { subscribeToBackInStock, listSubscriptions } from "@/lib/inventory/stock-notifications";
import { stockNotifications, abandonedCarts, customers } from "@/lib/db/schema";
import { syncAbandonedCart, listAbandonedCarts, abandonedCartKpis } from "@/lib/marketing/abandoned-carts";

afterAll(() => pool.end());

describe("back-in-stock notifications", () => {
  beforeEach(resetDb);

  it("notifies pending subscribers once a variant crosses from zero to positive available stock", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 0 });
    await subscribeToBackInStock(db, variant.id, "waiting@example.com");
    await restock(db, staff, { variantId: variant.id, quantity: 5 });
    const [sub] = await db.select().from(stockNotifications).where(eq(stockNotifications.variantId, variant.id));
    expect(sub!.notifiedAt).not.toBeNull();
  });

  it("does not notify again on a second restock once already notified", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 0 });
    await subscribeToBackInStock(db, variant.id, "waiting@example.com");
    await restock(db, staff, { variantId: variant.id, quantity: 5 });
    const [first] = await db.select().from(stockNotifications).where(eq(stockNotifications.variantId, variant.id));
    await adjustStock(db, staff, { variantId: variant.id, newStockQuantity: 0, movementType: "ADJUSTMENT" });
    await restock(db, staff, { variantId: variant.id, quantity: 3 });
    const [second] = await db.select().from(stockNotifications).where(eq(stockNotifications.variantId, variant.id));
    expect(second!.notifiedAt?.getTime()).toBe(first!.notifiedAt?.getTime());
  });

  it("does not notify when stock never actually reached zero", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 5 });
    await subscribeToBackInStock(db, variant.id, "waiting@example.com");
    await restock(db, staff, { variantId: variant.id, quantity: 5 });
    const [sub] = await db.select().from(stockNotifications).where(eq(stockNotifications.variantId, variant.id));
    expect(sub!.notifiedAt).toBeNull();
  });

  it("a customer can list their own subscriptions", async () => {
    const { variant } = await makeVariant({ stock: 0 });
    const [cust] = await db.insert(customers).values({ email: "sub@example.com", name: "Sub" }).returning();
    await subscribeToBackInStock(db, variant.id, "sub@example.com", cust!.id);
    const subs = await listSubscriptions(db, cust!.id);
    expect(subs).toHaveLength(1);
  });
});

describe("abandoned cart tracking", () => {
  beforeEach(resetDb);

  it("syncs cart items and computes cart value, then removes the row when the cart empties", async () => {
    const { variant } = await makeVariant({ stock: 10, priceCents: 5_000 });
    const [c] = await db.insert(customers).values({ email: "cart@example.com", name: "Cart" }).returning();
    await syncAbandonedCart(db, c!.id, [{ variantId: variant.id, quantity: 2, unitPriceCents: 5_000, name: "Test" }]);
    const [row] = await db.select().from(abandonedCarts).where(eq(abandonedCarts.customerId, c!.id));
    expect(row!.cartValueCents).toBe(10_000);

    await syncAbandonedCart(db, c!.id, []);
    const after = await db.select().from(abandonedCarts).where(eq(abandonedCarts.customerId, c!.id));
    expect(after).toHaveLength(0);
  });

  it("lists carts with an effective status derived from age, not a stored flag", async () => {
    const { variant } = await makeVariant({ stock: 10, priceCents: 5_000 });
    const [c] = await db.insert(customers).values({ email: "old-cart@example.com", name: "Old Cart" }).returning();
    await syncAbandonedCart(db, c!.id, [{ variantId: variant.id, quantity: 1, unitPriceCents: 5_000, name: "Test" }]);
    await db.update(abandonedCarts).set({ lastActivityAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(abandonedCarts.customerId, c!.id));

    const { rows } = await listAbandonedCarts(db, 24, 1, 25);
    expect(rows[0]!.effectiveStatus).toBe("abandoned");
    const kpis = await abandonedCartKpis(db, 24);
    expect(kpis.abandoned).toBeGreaterThanOrEqual(1);
  });
});
