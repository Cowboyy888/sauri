import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, resetDb, makeVariant, makeStaff, buyer, ALL_TIME } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import {
  getCustomerAnalytics, getCustomerLifetimeValue, getMetrics, getSalesBy, getSalesByCategory, getSalesByChannel, getSeries, getTopCustomers, getTopProducts, resolveRange,
} from "@/lib/analytics/service";
import { STORE } from "@/lib/config";

const day = 86_400_000;

describe("analytics", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("date ranges filter KPIs; the previous period has the same length and ends where the range starts", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 100 });
    const now = Date.now();
    const at = (d: number, q: number) => placeOrder(db, { lines: [{ variantId: variant.id, quantity: q }], customer: buyer, status: "paid", channel: "MANUAL_ORDER", placedAt: new Date(now - d * day) }, staff);
    await at(40, 1);
    await at(2, 2);
    const r30 = await resolveRange(db, "30d");
    expect((await getMetrics(db, r30)).units).toBe(2);
    expect((await getMetrics(db, r30.previous)).units).toBe(1);
    expect(r30.previous.to.getTime()).toBe(r30.from.getTime());
    expect((await getMetrics(db, await resolveRange(db, "all"))).orders).toBe(2);
    expect((await getMetrics(db, await resolveRange(db, "today"))).orders).toBe(0);
  });

  it("days are cut in the business time zone, not UTC or the browser's", async () => {
    expect(STORE.timezone).toBe("Asia/Phnom_Penh"); // UTC+7
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 10 });
    // 2026-03-10 18:30 UTC is 01:30 on 11 March in Phnom Penh.
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER", placedAt: new Date("2026-03-10T18:30:00Z") }, staff);
    const mar10 = await resolveRange(db, "custom", { from: "2026-03-10", to: "2026-03-10" });
    const mar11 = await resolveRange(db, "custom", { from: "2026-03-11", to: "2026-03-11" });
    expect((await getMetrics(db, mar10)).orders).toBe(0);
    expect((await getMetrics(db, mar11)).orders).toBe(1);
  });

  it("gross profit = net revenue − COGS; fees and carrier cost are reported separately as contribution profit", async () => {
    const { variant } = await makeVariant({ stock: 100, priceCents: 20_000, costCents: 8_000 });
    const staff = await makeStaff("SALES");
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "INSTAGRAM" }, staff);
    const m = await getMetrics(db, ALL_TIME);
    expect(m).toMatchObject({ netRevenueCents: 20_000, cogsCents: 8_000, grossProfitCents: 12_000, grossMarginPct: 60 });
    expect(m.contributionProfitCents).toBe(12_000 - o.paymentFeeCents - o.shippingCostCents);
  });

  it("series, category, product, material and channel breakdowns all reconcile to net revenue", async () => {
    const staff = await makeStaff("SALES");
    const a = await makeVariant({ code: "AAA", stock: 50 });
    const b = await makeVariant({ code: "BBB", name: "Luna Hoops", stock: 50, category: "earrings", priceCents: 6_000, costCents: 2_000 });
    await placeOrder(db, { lines: [{ variantId: a.variant.id, quantity: 1 }, { variantId: b.variant.id, quantity: 2 }], customer: buyer, status: "paid", channel: "PHYSICAL_STORE", discountCode: null }, staff);
    await placeOrder(db, { lines: [{ variantId: b.variant.id, quantity: 1 }], customer: { email: "b@example.com", name: "B" }, status: "paid", channel: "INSTAGRAM" }, staff);
    const r = await resolveRange(db, "7d");
    const net = (await getMetrics(db, r)).netRevenueCents;
    const sum = (xs: { netRevenueCents: number }[]) => xs.reduce((s, x) => s + x.netRevenueCents, 0);
    expect(sum((await getSeries(db, r)).points)).toBe(net);
    for (const by of ["product", "category", "material", "sku"] as const) expect(sum(await getSalesBy(db, r, by))).toBe(net);
    expect(sum(await getSalesByChannel(db, r))).toBe(net);
    expect((await getSalesByCategory(db, r)).map((x) => x.key)).toEqual(["earrings", "rings"]); // 3 × $60 beats 1 × $100
    expect((await getTopProducts(db, r, "units"))[0]!.label).toBe("Luna Hoops");
    const ch = await getSalesByChannel(db, r);
    expect(ch.reduce((a, x) => a + x.shareOfRevenuePct, 0)).toBeCloseTo(100, 1);
  });

  it("customer statistics and lifetime value are derived from orders", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 50 });
    for (let i = 0; i < 2; i++) await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, staff);
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "b@example.com", name: "B" }, status: "paid", channel: "MANUAL_ORDER" }, staff);
    const [top] = await getTopCustomers(db, 1);
    expect(top).toMatchObject({ email: "ana@example.com", totalOrders: 2, totalSpentCents: 20_000, averageOrderValueCents: 10_000, grossProfitCents: 10_000 });
    expect(await getCustomerLifetimeValue(db, top!.customerId)).toBe(20_000);
    expect(await getCustomerAnalytics(db, await resolveRange(db, "7d"))).toMatchObject({ newCustomers: 2, returningCustomers: 0, repeatPurchaseRatePct: 50, averageLifetimeValueCents: 15_000 });
  });
});
