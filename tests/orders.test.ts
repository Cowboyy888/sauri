import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { db, pool, resetDb, makeVariant, makeStaff, buyer, ALL_TIME, TEST_URL } from "./helpers";
import { markOrderPaid, placeOrder, quoteCart, recordPaymentFailure, updateOrderStatus } from "@/lib/orders/service";
import { getMetrics } from "@/lib/analytics/service";
import { allocateDiscount, computeTotals } from "@/lib/orders/pricing";
import { EVENTS_CHANNEL } from "@/lib/audit";
import { auditLogs, discounts, inventory, inventoryMovements, notifications, orderItems, orders, productVariants, products, refunds } from "@/lib/db/schema";

const stock = async (id: string) => (await db.select().from(inventory).where(eq(inventory.variantId, id)))[0]!;
const one = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;

describe("orders", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("prices come from the database; a client-sent price is ignored", async () => {
    const { variant } = await makeVariant({ priceCents: 10_000 });
    const q = await quoteCart(db, { lines: [{ variantId: variant.id, quantity: 1, priceCents: 1 } as never] });
    expect(q.subtotalCents).toBe(10_000);
  });

  it("website totals: 8% tax, free shipping from $150, card fee 2.9% + 30¢, carrier cost recorded", async () => {
    const { variant } = await makeVariant({ priceCents: 7_500 });
    const q1 = await quoteCart(db, { lines: [{ variantId: variant.id, quantity: 1 }] });
    expect(q1).toMatchObject({ subtotalCents: 7_500, shippingTotalCents: 800, taxTotalCents: 600, totalCents: 8_900, shippingCostCents: 650 });
    expect(q1.paymentFeeCents).toBe(Math.round(8_900 * 0.029) + 30);
    expect((await quoteCart(db, { lines: [{ variantId: variant.id, quantity: 2 }] })).shippingTotalCents).toBe(0);
  });

  it("rejects an order when stock is insufficient, with a clear message, and leaves nothing behind", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 2 });
    await expect(placeOrder(db, { lines: [{ variantId: variant.id, quantity: 3 }], customer: buyer, status: "paid", channel: "PHYSICAL_STORE" }, staff))
      .rejects.toThrow("Only 2 units of Aurora Ring (14K Yellow Gold / Size 6) available.");
    expect((await stock(variant.id)).stockQuantity).toBe(2);
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(inventoryMovements)).toHaveLength(0);
  });

  it("two customers racing for the last unit: exactly one wins", async () => {
    const { variant } = await makeVariant({ stock: 1 });
    const attempt = (email: string) => placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email, name: email } });
    const results = await Promise.allSettled([attempt("a@example.com"), attempt("b@example.com")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock(variant.id)).toMatchObject({ stockQuantity: 1, reservedQuantity: 1 });
  });

  it("the storefront cannot create a paid order; only payment confirmation can", async () => {
    const { variant } = await makeVariant();
    await expect(placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid" })).rejects.toThrow(/payment provider/);
  });

  it("checkout reserves stock; payment converts it to a SALE; a repeated webhook changes nothing", async () => {
    const { variant } = await makeVariant({ stock: 5 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer });
    expect(await stock(variant.id)).toMatchObject({ stockQuantity: 5, reservedQuantity: 2 });
    expect(await one(o.id)).toMatchObject({ status: "pending", paymentStatus: "unpaid" });
    await expect(placeOrder(db, { lines: [{ variantId: variant.id, quantity: 4 }], customer: { email: "x@example.com", name: "X" } })).rejects.toThrow(/Only 3 units/);
    await markOrderPaid(db, o.id, { providerRef: "pi_123" });
    expect(await stock(variant.id)).toMatchObject({ stockQuantity: 3, reservedQuantity: 0 });
    expect((await markOrderPaid(db, o.id, { providerRef: "pi_123" })).alreadyProcessed).toBe(true);
    expect((await stock(variant.id)).stockQuantity).toBe(3);
    expect(await db.select().from(inventoryMovements)).toHaveLength(1);
  });

  it("a failed payment keeps the order pending, marks it failed and notifies staff", async () => {
    const { variant } = await makeVariant();
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer });
    await recordPaymentFailure(db, o.id, "card_declined");
    expect(await one(o.id)).toMatchObject({ status: "pending", paymentStatus: "failed" });
    expect((await db.select().from(notifications)).map((n) => n.type)).toContain("payment_failed");
  });

  it("cancelling a pending order releases the reservation without a movement", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 5 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer });
    await updateOrderStatus(db, owner, o.id, "cancelled");
    expect(await stock(variant.id)).toMatchObject({ stockQuantity: 5, reservedQuantity: 0 });
    expect(await one(o.id)).toMatchObject({ status: "cancelled", paymentStatus: "unpaid", fulfillmentStatus: "cancelled" });
    expect(await db.select().from(inventoryMovements)).toHaveLength(0);
  });

  it("status, payment status and fulfillment status move together", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant();
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await updateOrderStatus(db, owner, o.id, "processing");
    await updateOrderStatus(db, owner, o.id, "shipped");
    expect(await one(o.id)).toMatchObject({ status: "shipped", paymentStatus: "paid", fulfillmentStatus: "shipped" });
    await updateOrderStatus(db, owner, o.id, "refunded");
    // A refund is a money-only event and must not overwrite real fulfillment progress (brief §42) —
    // "shipped" is preserved rather than being coerced into a coarse "returned".
    expect(await one(o.id)).toMatchObject({ status: "refunded", paymentStatus: "refunded", fulfillmentStatus: "shipped" });
    await expect(updateOrderStatus(db, owner, o.id, "delivered")).rejects.toThrow(/cannot become delivered/);
  });

  it("refund: stock returns, revenue and COGS reverse, the order's profit snapshot updates, it is audited", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await updateOrderStatus(db, owner, o.id, "refunded", { reason: "Changed mind" });
    expect((await stock(variant.id)).stockQuantity).toBe(10);
    expect(await getMetrics(db, ALL_TIME)).toMatchObject({ revenueCents: 20_000, refundCents: 20_000, netRevenueCents: 0, cogsCents: 0, grossProfitCents: 0, units: 0 });
    expect(await one(o.id)).toMatchObject({ refundTotalCents: 20_000, costTotalCents: 0, grossProfitCents: 0 });
    expect((await db.select().from(inventoryMovements)).map((m) => m.movementType)).toEqual(["SALE", "RETURN"]);
    expect(await db.select().from(refunds)).toHaveLength(1);
    expect((await db.select().from(auditLogs)).map((a) => a.action)).toContain("Refunded order");
  });

  it("refund without restock (damaged goods): revenue reverses but the cost stays, so the loss shows", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await updateOrderStatus(db, owner, o.id, "refunded", { restock: false, reason: "Arrived damaged" });
    expect((await stock(variant.id)).stockQuantity).toBe(9);
    expect(await getMetrics(db, ALL_TIME)).toMatchObject({ netRevenueCents: 0, cogsCents: 5_000, grossProfitCents: -5_000 });
  });

  it("order items are snapshots: renaming a product or changing its price or cost later changes nothing historical", async () => {
    const owner = await makeStaff("OWNER");
    const { variant, product } = await makeVariant();
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await db.update(products).set({ name: "Aurora Signet (renamed)" }).where(eq(products.id, product.id));
    await db.update(productVariants).set({ sellingPriceCents: 99_900, costPriceCents: 80_000 }).where(eq(productVariants.id, variant.id));
    const [line] = await db.select().from(orderItems);
    expect(line).toMatchObject({ productNameSnapshot: "Aurora Ring", unitPriceCents: 10_000, unitCostCents: 5_000 });
    expect(await getMetrics(db, ALL_TIME)).toMatchObject({ netRevenueCents: 10_000, grossProfitCents: 5_000 });
  });

  it("variant labels never repeat the color the material already names", async () => {
    const { variantLabel } = await import("@/lib/orders/service");
    expect(variantLabel({ material: "yg", color: "Yellow Gold", size: "6", gemstone: null })).toBe("14K Yellow Gold / Size 6");
    expect(variantLabel({ material: "wg", color: "Rose", size: null, gemstone: "Diamond" })).toBe("14K White Gold / Rose / Diamond");
    const { variant } = await makeVariant();
    await db.update(productVariants).set({ color: "Yellow Gold" }).where(eq(productVariants.id, variant.id));
    const r = await db.execute(sql`select variant_label from variant_stock`);
    expect(r.rows[0]).toEqual({ variant_label: "14K Yellow Gold / Size 6" });
  });

  it("the order discount is allocated to lines and always sums exactly", async () => {
    const d = { type: "percent" as const, value: 10, categoryId: null, productId: null, maxDiscountCents: null };
    const lines = [1_001, 2_003, 997].map((p, i) => ({ unitPriceCents: p, unitCostCents: 0, quantity: 1, productId: `p${i}`, categoryId: "c", collectionId: null }));
    const shares = allocateDiscount(lines, d, 401);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(401);
    const t = computeTotals(lines, d, { feePercentBp: 0, feeFixedCents: 0, shipsOrders: false, chargesShipping: false }, false);
    expect(t.lineAmounts.reduce((a, l) => a + l.lineTotalCents, 0)).toBe(t.subtotalCents - t.discountTotalCents);
  });

  it("low and out-of-stock notifications fire once, on the transition", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 7, reorder: 5 });
    const buy = (q: number, e: string) => placeOrder(db, { lines: [{ variantId: variant.id, quantity: q }], customer: { email: e, name: e }, status: "paid", channel: "PHYSICAL_STORE" }, staff);
    await buy(2, "a@example.com"); // 7 → 5: crosses the reorder level
    await buy(1, "b@example.com"); // 5 → 4: already low, no repeat
    await buy(4, "c@example.com"); // 4 → 0
    const types = (await db.select().from(notifications)).map((n) => n.type);
    expect(types.filter((t) => t === "low_stock")).toHaveLength(1);
    expect(types.filter((t) => t === "out_of_stock")).toHaveLength(1);
    expect(types.filter((t) => t === "new_order")).toHaveLength(3);
  });

  it("discount codes are validated on the server: minimum, cap, expiry, usage limit, per customer", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ priceCents: 5_000, stock: 50 });
    await db.insert(discounts).values([
      { code: "TEN", type: "percent", value: 10 },
      { code: "BIG", type: "percent", value: 15, minSubtotalCents: 10_000, maxDiscountCents: 1_000 },
      { code: "OLD", type: "percent", value: 10, endsAt: new Date(Date.now() - 86_400_000) },
      { code: "ONCE", type: "fixed", value: 500, usageLimit: 1 },
      { code: "MINE", type: "percent", value: 5, perCustomerLimit: 1 },
    ]);
    const line = (q: number) => [{ variantId: variant.id, quantity: q }];
    const paid = (code: string, customer = buyer) => placeOrder(db, { lines: line(1), discountCode: code, customer, status: "paid", channel: "MANUAL_ORDER" }, staff);
    expect((await quoteCart(db, { lines: line(1), discountCode: "ten" })).discountTotalCents).toBe(500);
    expect((await quoteCart(db, { lines: line(1), discountCode: "BIG" })).discountError).toMatch(/minimum/);
    expect((await quoteCart(db, { lines: line(3), discountCode: "BIG" })).discountTotalCents).toBe(1_000);
    expect((await quoteCart(db, { lines: line(1), discountCode: "OLD" })).discountError).toMatch(/expired/);
    expect((await quoteCart(db, { lines: line(1), discountCode: "NOPE" })).discountError).toMatch(/not a valid code/);
    await paid("ONCE");
    await expect(paid("ONCE", { email: "z@example.com", name: "Z" })).rejects.toThrow(/usage limit/);
    await paid("MINE");
    await expect(paid("MINE")).rejects.toThrow(/already used/);
  });

  it("the database itself refuses negative stock, wrong totals and wrong line math", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 1 });
    await expect(db.update(inventory).set({ stockQuantity: -1 }).where(eq(inventory.variantId, variant.id))).rejects.toThrow();
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await expect(db.update(orders).set({ totalCents: 1 }).where(eq(orders.id, o.id))).rejects.toThrow();
    await expect(db.update(orders).set({ grossProfitCents: 999_999 }).where(eq(orders.id, o.id))).rejects.toThrow();
    await expect(db.update(orderItems).set({ lineProfitCents: 1 }).where(eq(orderItems.orderId, o.id))).rejects.toThrow();
  });

  it("dashboards are told about a paid order only after it commits", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 1 });
    const listener = new Client({ connectionString: TEST_URL });
    await listener.connect();
    const events: { type: string }[] = [];
    listener.on("notification", (m) => events.push(JSON.parse(m.payload ?? "{}")));
    await listener.query(`LISTEN ${EVENTS_CHANNEL}`);
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await expect(placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 150));
    await listener.end();
    expect(events.filter((e) => e.type === "order.paid")).toHaveLength(1); // the failed order announced nothing
    expect(events.some((e) => e.type === "inventory.changed")).toBe(true);
  });
});
