/** Review submission eligibility, duplicate prevention, and moderation history (brief §20-22, §45). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { orders } from "@/lib/db/schema";
import { createReview, getModerationHistory, getReviewableProducts, moderateReview } from "@/lib/reviews/service";

async function deliveredOrder(variantId: string) {
  const owner = { userId: null, name: "seed", role: "OWNER" as const };
  const order = await placeOrder(db, { lines: [{ variantId, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
  await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, order.id));
  return order;
}

describe("reviews", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("lists a delivered order's product as reviewable, and not once reviewed", async () => {
    const { variant, product } = await makeVariant({ stock: 10 });
    const order = await deliveredOrder(variant.id);
    let reviewable = await getReviewableProducts(db, order.customerId!);
    expect(reviewable.map((r) => r.productId)).toContain(product.id);

    await createReview(db, order.customerId!, { orderId: order.id, productId: product.id, rating: 5, title: "Lovely", body: "Great piece." });
    reviewable = await getReviewableProducts(db, order.customerId!);
    expect(reviewable.map((r) => r.productId)).not.toContain(product.id);
  });

  it("rejects a review for an order that isn't delivered yet", async () => {
    const owner = { userId: null, name: "seed", role: "OWNER" as const };
    const { variant, product } = await makeVariant({ stock: 10 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    await expect(createReview(db, order.customerId!, { orderId: order.id, productId: product.id, rating: 5, title: "T", body: "B" })).rejects.toThrow(/delivered/);
  });

  it("rejects reviewing an order that belongs to someone else", async () => {
    const { variant, product } = await makeVariant({ stock: 10 });
    const order = await deliveredOrder(variant.id);
    await expect(createReview(db, "00000000-0000-0000-0000-000000000000", { orderId: order.id, productId: product.id, rating: 4, title: "T", body: "B" })).rejects.toThrow(/does not belong to you/);
  });

  it("prevents a duplicate review for the same order and product", async () => {
    const { variant, product } = await makeVariant({ stock: 10 });
    const order = await deliveredOrder(variant.id);
    await createReview(db, order.customerId!, { orderId: order.id, productId: product.id, rating: 5, title: "First", body: "Good." });
    await expect(createReview(db, order.customerId!, { orderId: order.id, productId: product.id, rating: 3, title: "Second", body: "Again." })).rejects.toThrow(/already reviewed/);
  });

  it("follows the moderation state machine and records history", async () => {
    const staff = await makeStaff("OWNER");
    const { variant, product } = await makeVariant({ stock: 10 });
    const order = await deliveredOrder(variant.id);
    const review = await createReview(db, order.customerId!, { orderId: order.id, productId: product.id, rating: 5, title: "T", body: "B" });

    await expect(moderateReview(db, staff, review.id, "hidden")).rejects.toThrow(/cannot move to/);
    await moderateReview(db, staff, review.id, "published");
    await moderateReview(db, staff, review.id, "hidden", "Reported as spam");
    const history = await getModerationHistory(db, review.id);
    expect(history.map((h) => `${h.fromStatus}->${h.toStatus}`)).toEqual(["pending->published", "published->hidden"]);
    expect(history[1]!.note).toBe("Reported as spam");
  });

  it("blocks a role without reviews:write from moderating", async () => {
    const sales = await makeStaff("SALES");
    const { variant, product } = await makeVariant({ stock: 10 });
    const order = await deliveredOrder(variant.id);
    const review = await createReview(db, order.customerId!, { orderId: order.id, productId: product.id, rating: 5, title: "T", body: "B" });
    await expect(moderateReview(db, sales, review.id, "published")).rejects.toThrow(/cannot perform reviews:write/);
  });
});
