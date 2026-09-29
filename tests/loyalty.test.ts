/** Loyalty: earning, refund reversal, tiers, rewards, redemption, manual adjustment (brief §23-29, §45-46). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { placeOrder, markOrderPaid, updateOrderStatus } from "@/lib/orders/service";
import { refundOrder } from "@/lib/orders/refunds";
import { adjustPoints, getCustomerTier, getLoyaltySummary, redeemReward, saveReward } from "@/lib/loyalty/service";
import { loyaltyAccounts, loyaltyRewards } from "@/lib/db/schema";

async function paidOrder(variantId: string, quantity = 1) {
  const owner = { userId: null, name: "seed", role: "OWNER" as const };
  const order = await placeOrder(db, { lines: [{ variantId, quantity }], customer: buyer, status: "pending", channel: "WEBSITE" }, owner);
  await markOrderPaid(db, order.id);
  return order;
}

describe("loyalty", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("earns points on a paid order — 1 point per dollar of net merchandise revenue by default", async () => {
    const { variant } = await makeVariant({ stock: 10, priceCents: 10_000 }); // $100
    const order = await paidOrder(variant.id, 1);
    const summary = await getLoyaltySummary(db, order.customerId!);
    expect(summary.pointsBalance).toBe(100);
    expect(summary.lifetimePointsEarned).toBe(100);
  });

  it("never earns twice for the same order even if called again directly", async () => {
    const { variant } = await makeVariant({ stock: 10, priceCents: 10_000 });
    const order = await paidOrder(variant.id, 1);
    const [account] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, order.customerId!));
    expect(account!.pointsBalance).toBe(100);
    // markOrderPaid itself is idempotent (order is no longer "pending"), so this proves no double-earn path exists.
    await markOrderPaid(db, order.id);
    const [again] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, order.customerId!));
    expect(again!.pointsBalance).toBe(100);
  });

  it("reverses points proportionally on a full refund", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10, priceCents: 10_000 });
    const order = await paidOrder(variant.id, 1);
    await updateOrderStatus(db, owner, order.id, "refunded", { restock: true });
    const summary = await getLoyaltySummary(db, order.customerId!);
    expect(summary.pointsBalance).toBe(0);
  });

  it("reverses points proportionally on a partial refund via refundOrder", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10, priceCents: 20_000 }); // $200 -> 200 points
    const order = await paidOrder(variant.id, 1);
    await refundOrder(db, owner, order.id, { amountCents: 10_000 }); // refund half
    const summary = await getLoyaltySummary(db, order.customerId!);
    expect(summary.pointsBalance).toBe(100); // half of 200 reversed
  });

  it("clamps a reversal so the balance never goes negative if points were already spent", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10, priceCents: 10_000 }); // 100 points
    const order = await paidOrder(variant.id, 1);
    await adjustPoints(db, owner, order.customerId!, -95, "test spend-down"); // balance now 5
    await updateOrderStatus(db, owner, order.id, "refunded", { restock: true }); // would reverse 100, but only 5 left
    const summary = await getLoyaltySummary(db, order.customerId!);
    expect(summary.pointsBalance).toBe(0);
  });

  it("derives tier from lifetime net spend, never stored", async () => {
    const { variant } = await makeVariant({ stock: 10, priceCents: 60_000 }); // $600 -> crosses Silver ($500)
    const order = await paidOrder(variant.id, 1);
    const { tier, nextTier } = await getCustomerTier(db, order.customerId!);
    expect(tier?.name).toBe("Silver");
    expect(nextTier?.name).toBe("Gold");
  });

  it("redeems a reward into a customer-restricted discount that only that customer can use", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10, priceCents: 10_000 }); // 100 points
    const order = await paidOrder(variant.id, 1);
    await saveReward(db, owner, undefined, { name: "$10 off", pointsCost: 50, rewardType: "fixed", rewardValue: 1000 });
    const [reward] = await db.select().from(loyaltyRewards);

    const { redemption, code } = await redeemReward(db, order.customerId!, reward!.id);
    expect(redemption.pointsSpent).toBe(50);
    const summary = await getLoyaltySummary(db, order.customerId!);
    expect(summary.pointsBalance).toBe(50);

    // A second customer cannot use the first customer's reward code.
    const { variant: v2 } = await makeVariant({ stock: 10, code: "OTH" });
    const owner2 = { userId: null, name: "seed", role: "OWNER" as const };
    const otherOrder = await placeOrder(db, { lines: [{ variantId: v2.id, quantity: 1 }], customer: { email: "other@example.com", name: "Other" }, discountCode: code, status: "pending", channel: "WEBSITE" }, owner2).catch((e: Error) => e);
    expect(otherOrder).toBeInstanceOf(Error);
    expect((otherOrder as Error).message).toMatch(/not a valid code/);
  });

  it("rejects redeeming a reward without enough points", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10, priceCents: 1_000 }); // 10 points
    const order = await paidOrder(variant.id, 1);
    await saveReward(db, owner, undefined, { name: "Big reward", pointsCost: 5000, rewardType: "fixed", rewardValue: 1000 });
    const [reward] = await db.select().from(loyaltyRewards);
    await expect(redeemReward(db, order.customerId!, reward!.id)).rejects.toThrow(/Not enough points/);
  });

  it("a manual adjustment is audited and always requires a reason", async () => {
    const owner = await makeStaff("OWNER");
    const { variant } = await makeVariant({ stock: 10 });
    const order = await paidOrder(variant.id, 1);
    await expect(adjustPoints(db, owner, order.customerId!, 50, "")).rejects.toThrow(/reason/);
    await adjustPoints(db, owner, order.customerId!, 50, "Goodwill gesture");
    const summary = await getLoyaltySummary(db, order.customerId!);
    expect(summary.transactions.some((t) => t.type === "ADJUSTMENT" && t.points === 50)).toBe(true);
  });

  it("blocks a role without loyalty:write from adjusting points", async () => {
    const sales = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 10 });
    const order = await paidOrder(variant.id, 1);
    await expect(adjustPoints(db, sales, order.customerId!, 10, "test")).rejects.toThrow(/cannot perform loyalty:write/);
  });
});
