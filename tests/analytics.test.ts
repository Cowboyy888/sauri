import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, resetDb, makeVariant, buyer } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { getCustomerAnalytics, getMetrics, getSalesBy, getSalesByChannel, getSeries, resolveRange } from "@/lib/analytics/service";
import { computeTotals } from "@/lib/orders/pricing";

const day = 86_400_000;

describe("analytics", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("date ranges filter KPIs; previous period is the same length immediately before", async () => {
    const { variant } = await makeVariant(db, { stock: 100 });
    const now = Date.now();
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "manual", placedAt: new Date(now - 40 * day) });
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 2 }], customer: buyer, status: "paid", channel: "manual", placedAt: new Date(now - 2 * day) });
    const r30 = await resolveRange(db, "30d");
    expect((await getMetrics(db, r30)).units).toBe(2);
    expect((await getMetrics(db, r30.previous)).units).toBe(1);
    const all = await resolveRange(db, "all");
    expect((await getMetrics(db, all)).orders).toBe(2);
    expect(r30.previous.to.getTime()).toBe(r30.from.getTime());
  });

  it("gross profit subtracts discounts, refunds, COGS, payment fees and shipping cost", async () => {
    const { variant } = await makeVariant(db, { stock: 100, priceCents: 20_000, costCents: 8_000 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "web" });
    const m = await getMetrics(db, await resolveRange(db, "all"));
    expect(m.netRevenueCents).toBe(20_000);
    expect(m.grossProfitCents).toBe(20_000 - 8_000 - o.paymentFeeCents - o.shippingCostCents);
    expect(m.grossMarginPct).toBeCloseTo((m.grossProfitCents / 20_000) * 100, 2);
  });

  it("series, category, channel and customer breakdowns agree with the headline total", async () => {
    const a = await makeVariant(db, { code: "AAA", stock: 50 });
    const b = await makeVariant(db, { code: "BBB", stock: 50, category: "earrings", priceCents: 6_000, costCents: 2_000 });
    await placeOrder(db, { lines: [{ variantId: a.variant.id, quantity: 1 }, { variantId: b.variant.id, quantity: 2 }], customer: buyer, status: "paid", channel: "store" });
    await placeOrder(db, { lines: [{ variantId: b.variant.id, quantity: 1 }], customer: { email: "b@example.com", name: "B" }, status: "paid", channel: "instagram" });
    const r = await resolveRange(db, "7d");
    const m = await getMetrics(db, r);
    const sum = (xs: { revenueCents: number }[]) => xs.reduce((s, x) => s + x.revenueCents, 0);
    expect(sum((await getSeries(db, r)).points)).toBe(m.netRevenueCents);
    expect(sum(await getSalesBy(db, r, "category"))).toBe(m.netRevenueCents);
    expect(sum(await getSalesByChannel(db, r))).toBe(m.netRevenueCents);
    const ca = await getCustomerAnalytics(db, r);
    expect(ca).toMatchObject({ newCustomers: 2, returningCustomers: 0, repeatPurchaseRatePct: 0 });
  });

  it("pure totals: percent discount limited to a category", () => {
    const t = computeTotals(
      [{ unitPriceCents: 10_000, unitCostCents: 4_000, quantity: 1, productId: "p1", categoryId: "rings" }, { unitPriceCents: 5_000, unitCostCents: 2_000, quantity: 1, productId: "p2", categoryId: "ears" }],
      { type: "percent", value: 20, categoryId: "rings", productId: null, maxDiscountCents: null },
      { feePercentBp: 0, feeFixedCents: 0, shipsOrders: false, chargesShipping: false }, false);
    expect(t).toMatchObject({ subtotalCents: 15_000, discountCents: 2_000, taxCents: 1_040, totalCents: 14_040, cogsCents: 6_000 });
  });
});
