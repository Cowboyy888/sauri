/** Partial and full refunds (brief §19), and that the permission matrix still applies to them. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { refundOrder } from "@/lib/orders/refunds";
import { orders, refunds } from "@/lib/db/schema";

async function paidOrder(variantId: string, quantity = 2) {
  const owner = { userId: null, name: "seed", role: "OWNER" as const };
  return placeOrder(db, { lines: [{ variantId, quantity }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
}

describe("refunds", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("a partial refund reduces refund_total_cents and sets payment_status to partially_refunded, without touching order status", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000, costCents: 5_000 }); // $100 x 2 = $200 net
    const order = await paidOrder(variant.id, 2);

    const result = await refundOrder(db, staff, order.id, { amountCents: 5_000, reason: "Goodwill" });
    expect(result.full).toBe(false);

    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.refundTotalCents).toBe(5_000);
    expect(o!.paymentStatus).toBe("partially_refunded");
    expect(o!.status).toBe("paid"); // lifecycle status untouched by a partial refund
    expect(o!.grossProfitCents).toBe(o!.subtotalCents - o!.discountTotalCents - 5_000 - o!.costTotalCents);

    const rows = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountCents).toBe(5_000);
  });

  it("refunding the full remaining balance (across two partial refunds) marks the order refunded", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000, costCents: 5_000 });
    const order = await paidOrder(variant.id, 1); // net revenue $100

    await refundOrder(db, staff, order.id, { amountCents: 6_000 });
    const second = await refundOrder(db, staff, order.id, { amountCents: 4_000 });
    expect(second.full).toBe(true);

    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.refundTotalCents).toBe(10_000);
    expect(o!.paymentStatus).toBe("refunded");
    expect(o!.status).toBe("refunded");
  });

  it("rejects a refund larger than what remains refundable", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000 });
    const order = await paidOrder(variant.id, 1);
    await expect(refundOrder(db, staff, order.id, { amountCents: 20_000 })).rejects.toThrow(/at most/);
  });

  it("a pending (unpaid) order cannot be refunded", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 5 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "pending", channel: "WEBSITE" }, staff);
    await expect(refundOrder(db, staff, order.id, { amountCents: 100 })).rejects.toThrow(/cannot be refunded/);
  });

  it("VIEWER cannot refund; INVENTORY cannot refund; SALES and ADMIN can", async () => {
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000 });
    const order = await paidOrder(variant.id, 1);
    const viewer = await makeStaff("VIEWER");
    const inventoryStaff = await makeStaff("INVENTORY");
    await expect(refundOrder(db, viewer, order.id, { amountCents: 100 })).rejects.toThrow(/cannot perform orders:write/);
    await expect(refundOrder(db, inventoryStaff, order.id, { amountCents: 100 })).rejects.toThrow(/cannot perform orders:write/);
    const admin = await makeStaff("ADMIN");
    await expect(refundOrder(db, admin, order.id, { amountCents: 100 })).resolves.toMatchObject({ full: false });
  });
});
