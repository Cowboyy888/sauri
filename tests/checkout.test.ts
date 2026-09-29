/**
 * Checkout start: server-side price/stock validation and the reservation it creates (brief §5–§7).
 * Calls the real (Stripe test-mode) API — this project tests against real systems, not mocks.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { startCheckout } from "@/lib/payments/checkout";
import { inventory, orders, shippingMethods } from "@/lib/db/schema";
import { InsufficientStockError, ValidationError } from "@/lib/errors";

async function standardShippingId() {
  const [m] = await db.select({ id: shippingMethods.id }).from(shippingMethods).where(eq(shippingMethods.name, "Standard Shipping"));
  return m!.id;
}

const shippingAddress = { firstName: "Ana", lastName: "Reyes", line1: "1 River St", city: "Phnom Penh", postalCode: "12000", country: "KH" };

describe("checkout: startCheckout", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("recomputes price and stock from the database and creates a pending reservation, not a sale", async () => {
    const { variant } = await makeVariant({ stock: 100, priceCents: 10_000, costCents: 5_000 });
    const shippingMethodId = await standardShippingId();
    const result = await startCheckout(db, {
      lines: [{ variantId: variant.id, quantity: 3 }], shippingMethodId,
      customer: { email: "ana@example.com", name: "Ana Reyes" }, shippingAddress,
    });

    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.clientSecret).toMatch(/^cs_test_/);

    const [order] = await db.select().from(orders).where(eq(orders.id, result.orderId));
    expect(order!.status).toBe("pending");
    expect(order!.paymentStatus).toBe("unpaid");
    expect(order!.subtotalCents).toBe(30_000); // 3 x $100, from the DATABASE price — never trusted from the browser
    expect(order!.shippingMethodId).toBe(shippingMethodId);

    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(100); // unchanged — a reservation, not a deduction
    expect(inv!.reservedQuantity).toBe(3);
  });

  it("rejects a quantity above the available stock and reserves nothing", async () => {
    const { variant } = await makeVariant({ stock: 2 });
    const shippingMethodId = await standardShippingId();
    await expect(startCheckout(db, {
      lines: [{ variantId: variant.id, quantity: 5 }], shippingMethodId,
      customer: { email: "ana@example.com", name: "Ana Reyes" }, shippingAddress,
    })).rejects.toThrow(InsufficientStockError);
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.reservedQuantity).toBe(0);
  });

  it("rejects an unknown or inactive shipping method", async () => {
    const { variant } = await makeVariant({ stock: 10 });
    await expect(startCheckout(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], shippingMethodId: "00000000-0000-4000-8000-000000000000",
      customer: { email: "ana@example.com", name: "Ana Reyes" }, shippingAddress,
    })).rejects.toThrow(ValidationError);
  });

  it("a tampered/nonexistent variant id fails cleanly with nothing reserved", async () => {
    const shippingMethodId = await standardShippingId();
    await expect(startCheckout(db, {
      lines: [{ variantId: "00000000-0000-4000-8000-000000000099", quantity: 1 }], shippingMethodId,
      customer: { email: "ana@example.com", name: "Ana Reyes" }, shippingAddress,
    })).rejects.toThrow();
  });
});
