/**
 * Review submission (verified-purchase eligibility) and moderation history (brief §20-22). Display —
 * average rating, count, distribution, verified-purchase badge — already existed in
 * `lib/storefront/catalog.ts`'s `getReviews()` and is unchanged here. See docs/REVIEWS.md.
 */
import { and, eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { customers, orderItems, orders, products, reviewModerationEvents, reviews } from "../db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit, notify } from "../audit";
import { emailProvider, reviewApprovedEmail } from "../email/provider";

export type ReviewableOrder = { orderId: string; orderNumber: string; productId: string; productName: string; deliveredAt: Date | null };

/** Products a customer may review right now: delivered on a real order, not already reviewed on that
 *  order (brief: "customers can only review products they have legitimately purchased" + no duplicates). */
export async function getReviewableProducts(db: DbOrTx, customerId: string): Promise<ReviewableOrder[]> {
  const lines = await db.select({
    orderId: orders.id, orderNumber: orders.orderNumber, productId: orderItems.productId, productName: orderItems.productNameSnapshot, fulfillmentStatus: orders.fulfillmentStatus,
  }).from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.customerId, customerId), eq(orders.status, "delivered")));
  const already = await db.select({ orderId: reviews.orderId, productId: reviews.productId }).from(reviews).where(eq(reviews.customerId, customerId));
  const reviewed = new Set(already.map((r) => `${r.orderId}:${r.productId}`));
  return lines.filter((l) => !reviewed.has(`${l.orderId}:${l.productId}`)).map((l) => ({ orderId: l.orderId, orderNumber: l.orderNumber, productId: l.productId, productName: l.productName, deliveredAt: null }));
}

export type NewReviewInput = { orderId: string; productId: string; rating: number; title: string; body: string };
export async function createReview(db: Db, customerId: string, input: NewReviewInput) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new ValidationError("Choose a rating from 1 to 5 stars.");
  const title = input.title.trim(), body = input.body.trim();
  if (!title || !body) throw new ValidationError("Enter a title and a review.");

  return db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id, customerId: orders.customerId, status: orders.status }).from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw new NotFoundError("Order not found.");
    if (order.customerId !== customerId) throw new ForbiddenError("This order does not belong to you.");
    if (order.status !== "delivered") throw new ValidationError("You can review a product once your order has been delivered.");
    const [line] = await tx.select({ id: orderItems.id }).from(orderItems).where(and(eq(orderItems.orderId, input.orderId), eq(orderItems.productId, input.productId)));
    if (!line) throw new ValidationError("That product isn't on this order.");
    const [dup] = await tx.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.customerId, customerId), eq(reviews.orderId, input.orderId), eq(reviews.productId, input.productId)));
    if (dup) throw new ValidationError("You've already reviewed this product for this order.");

    const [customer] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
    const [row] = await tx.insert(reviews).values({ productId: input.productId, customerId, orderId: input.orderId, rating: input.rating, title, body, authorName: customer?.name ?? "Customer" }).returning();
    await notify(tx, "review", "New review awaiting moderation", `${title} (${input.rating}★)`, row!.id);
    return row!;
  });
}

const VALID_NEXT: Record<string, string[]> = {
  pending: ["published", "rejected"],
  published: ["hidden"],
  rejected: ["published"],
  hidden: ["published"],
};

/** Approve / reject / hide / restore (brief §22), each recorded to `review_moderation_events` — the
 *  content itself is never edited, only its status (brief: "never silently modify customer review content"). */
export async function moderateReview(db: Db, actor: Actor, reviewId: string, next: "published" | "rejected" | "hidden", note?: string) {
  assertCan(actor, "reviews:write");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(reviews).where(eq(reviews.id, reviewId)).for("update");
    if (!before) throw new NotFoundError("Review not found.");
    if (!VALID_NEXT[before.status]?.includes(next)) throw new ValidationError(`A review that is "${before.status}" cannot move to "${next}".`);
    await tx.update(reviews).set({ status: next }).where(eq(reviews.id, reviewId));
    await tx.insert(reviewModerationEvents).values({ reviewId, fromStatus: before.status, toStatus: next, note: note?.trim() || null, actorUserId: actor.userId });
    await audit(tx, actor, "Moderated review", "review", reviewId, { status: before.status }, { status: next });
    if (next === "published" && before.status === "pending" && before.customerId) {
      const [[c], [p]] = await Promise.all([
        tx.select({ email: customers.email }).from(customers).where(eq(customers.id, before.customerId)),
        tx.select({ name: products.name }).from(products).where(eq(products.id, before.productId)),
      ]);
      if (c && p) await emailProvider.send(reviewApprovedEmail({ email: c.email, productName: p.name }));
    }
  });
}

export async function getCustomerReviews(db: DbOrTx, customerId: string) {
  return db.select({ id: reviews.id, productId: reviews.productId, productName: products.name, rating: reviews.rating, title: reviews.title, body: reviews.body, status: reviews.status, createdAt: reviews.createdAt })
    .from(reviews).innerJoin(products, eq(products.id, reviews.productId))
    .where(eq(reviews.customerId, customerId)).orderBy(reviews.createdAt);
}

export async function getModerationHistory(db: DbOrTx, reviewId: string) {
  return db.select({ fromStatus: reviewModerationEvents.fromStatus, toStatus: reviewModerationEvents.toStatus, note: reviewModerationEvents.note, createdAt: reviewModerationEvents.createdAt })
    .from(reviewModerationEvents).where(eq(reviewModerationEvents.reviewId, reviewId)).orderBy(reviewModerationEvents.createdAt);
}
