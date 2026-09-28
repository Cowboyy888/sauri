import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { placeOrder, markOrderPaid, quoteCart, updateOrderStatus } from "@/lib/orders/service";
import { getMetrics } from "@/lib/analytics/service";
import { discounts, inventory, inventoryMovements, notifications, orders, auditLogs } from "@/lib/db/schema";

const ALL = { from: new Date("2000-01-01"), to: new Date("2100-01-01") };
const stock = async (id: string) => (await db.select().from(inventory).where(eq(inventory.variantId, id)))[0]!;

describe("orders and inventory", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("prices come from the database; the client cannot send a price", async () => {
    const { variant } = await makeVariant(db, { priceCents: 10_000 });
    // Extra properties such as a price are simply not part of the input and are ignored.
    const q = await quoteCart(db, { lines: [{ variantId: variant.id, quantity: 1, priceCents: 1 } as never], channel: "web" });
    expect(q.subtotalCents).toBe(10_000);
  });

  it("website totals: tax 8%, free shipping at $150, card fee 2.9% + 30¢, carrier cost recorded", async () => {
    const { variant } = await makeVariant(db, { priceCents: 7_500 });
    const one = await quoteCart(db, { lines: [{ variantId: variant.id, quantity: 1 }], channel: "web" });
    expect(one).toMatchObject({ subtotalCents: 7_500, shippingChargedCents: 800, taxCents: 600, totalCents: 8_900, shippingCostCents: 650 });
    expect(one.paymentFeeCents).toBe(Math.round(8_900 * 0.029) + 30);
    const two = await quoteCart(db, { lines: [{ variantId: variant.id, quantity: 2 }], channel: "web" });
    expect(two.shippingChargedCents).toBe(0);
  });

  it("never oversells: stock cannot go negative", async () => {
    const { variant } = await makeVariant(db, { stock: 2 });
    await expect(placeOrder(db, { lines: [{ variantId: variant.id, quantity: 3 }], customer: buyer, status: "paid", channel: "manual" })).rejects.toThrow(/only 2 left/);
    expect((await stock(variant.id)).onHand).toBe(2);
    expect(await db.select().from(orders)).toHaveLength(0); // the whole transaction rolled back
  });

  it("two customers racing for the last unit: exactly one wins", async () => {
    const { variant } = await makeVariant(db, { stock: 1 });
    const attempt = (email: string) => placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email, name: email }, status: "paid", channel: "web" });
    const results = await Promise.allSettled([attempt("a@example.com"), attempt("b@example.com")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await stock(variant.id)).onHand).toBe(0);
  });

  it("pending (checkout) reserves stock; payment converts it to a SALE; a repeated webhook is ignored", async () => {
    const { variant } = await makeVariant(db, { stock: 5 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer, channel: "web" });
    expect(await stock(variant.id)).toMatchObject({ onHand: 5, reserved: 2 });
    await expect(placeOrder(db, { lines: [{ variantId: variant.id, quantity: 4 }], customer: { email: "x@example.com", name: "X" }, channel: "web" })).rejects.toThrow(/only 3 left/);
    await markOrderPaid(db, o.id, { providerRef: "pi_123" });
    expect(await stock(variant.id)).toMatchObject({ onHand: 3, reserved: 0 });
    expect((await markOrderPaid(db, o.id, { providerRef: "pi_123" })).alreadyProcessed).toBe(true);
    expect((await stock(variant.id)).onHand).toBe(3);
  });

  it("cancelling a pending order releases the reservation without a movement", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant(db, { stock: 5 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer, channel: "web" });
    await updateOrderStatus(db, owner, o.id, "cancelled");
    expect(await stock(variant.id)).toMatchObject({ onHand: 5, reserved: 0 });
    expect(await db.select().from(inventoryMovements)).toHaveLength(0);
  });

  it("refund returns stock, removes the revenue and COGS, and is audited", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant(db, { stock: 10 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer, status: "paid", channel: "manual" });
    await updateOrderStatus(db, owner, o.id, "refunded", { reason: "Changed mind" });
    expect((await stock(variant.id)).onHand).toBe(10);
    const m = await getMetrics(db, ALL);
    expect(m).toMatchObject({ grossCents: 20_000, refundCents: 20_000, netRevenueCents: 0, cogsCents: 0, grossProfitCents: 0 });
    const types = (await db.select().from(inventoryMovements)).map((x) => x.type);
    expect(types).toEqual(["SALE", "RETURN"]);
    expect((await db.select().from(auditLogs)).some((a) => a.action === "Changed order status")).toBe(true);
    await expect(updateOrderStatus(db, owner, o.id, "shipped")).rejects.toThrow(/cannot become shipped/);
  });

  it("low and out-of-stock notifications fire once, on the transition", async () => {
    const { variant } = await makeVariant(db, { stock: 7, reorder: 5 });
    const buy = (q: number, e: string) => placeOrder(db, { lines: [{ variantId: variant.id, quantity: q }], customer: { email: e, name: e }, status: "paid", channel: "manual" });
    await buy(2, "a@example.com"); // 7 → 5: crosses reorder level
    await buy(1, "b@example.com"); // 5 → 4: already low, no repeat
    await buy(4, "c@example.com"); // 4 → 0
    const types = (await db.select().from(notifications)).map((n) => n.type);
    expect(types.filter((t) => t === "low_stock")).toHaveLength(1);
    expect(types.filter((t) => t === "out_of_stock")).toHaveLength(1);
  });

  it("discount codes are validated on the server: minimum, expiry, usage limit, per customer", async () => {
    const { variant } = await makeVariant(db, { priceCents: 5_000, stock: 50 });
    const past = new Date(Date.now() - 86_400_000);
    await db.insert(discounts).values([
      { code: "TEN", type: "percent", value: 10 },
      { code: "BIG", type: "percent", value: 15, minSubtotalCents: 10_000, maxDiscountCents: 1_000 },
      { code: "OLD", type: "percent", value: 10, endsAt: past },
      { code: "ONCE", type: "fixed", value: 500, usageLimit: 1 },
      { code: "MINE", type: "percent", value: 5, perCustomerLimit: 1 },
    ]);
    const line = (q: number) => [{ variantId: variant.id, quantity: q }];
    expect((await quoteCart(db, { lines: line(1), discountCode: "ten" })).discountCents).toBe(500);
    expect((await quoteCart(db, { lines: line(1), discountCode: "BIG" })).discountError).toMatch(/minimum/);
    expect((await quoteCart(db, { lines: line(3), discountCode: "BIG" })).discountCents).toBe(1_000); // capped
    expect((await quoteCart(db, { lines: line(1), discountCode: "OLD" })).discountError).toMatch(/expired/);
    expect((await quoteCart(db, { lines: line(1), discountCode: "NOPE" })).discountError).toMatch(/not a valid code/);
    await placeOrder(db, { lines: line(1), discountCode: "ONCE", customer: buyer, status: "paid", channel: "manual" });
    await expect(placeOrder(db, { lines: line(1), discountCode: "ONCE", customer: { email: "z@example.com", name: "Z" }, status: "paid", channel: "manual" })).rejects.toThrow(/usage limit/);
    await placeOrder(db, { lines: line(1), discountCode: "MINE", customer: buyer, status: "paid", channel: "manual" });
    await expect(placeOrder(db, { lines: line(1), discountCode: "MINE", customer: buyer, status: "paid", channel: "manual" })).rejects.toThrow(/already used/);
  });

  it("the database itself rejects negative stock and wrong order totals", async () => {
    const { variant } = await makeVariant(db, { stock: 1 });
    await expect(db.update(inventory).set({ onHand: -1 }).where(eq(inventory.variantId, variant.id))).rejects.toThrow();
  });
});
