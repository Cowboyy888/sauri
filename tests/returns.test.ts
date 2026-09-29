/** Returns workflow: eligibility, state machine, inspection-gated restocking, refunds (brief §19-25, §45). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import {
  createReturnRequest, updateReturnStatus, recordInspection, refundReturn, RETURN_TRANSITIONS,
} from "@/lib/returns/service";
import { inventory, orderItems, orders, returnItems } from "@/lib/db/schema";

async function deliveredOrder(variantId: string, quantity = 2) {
  const owner = { userId: null, name: "seed", role: "OWNER" as const };
  const order = await placeOrder(db, { lines: [{ variantId, quantity }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
  await db.update(orders).set({ status: "delivered", fulfillmentStatus: "delivered" }).where(eq(orders.id, order.id));
  return order;
}

describe("returns", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("lets the owning customer request a return for a delivered order", async () => {
    const { variant } = await makeVariant({ stock: 98 });
    const order = await deliveredOrder(variant.id, 2);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "wrong_size" }]);
    expect(rr.status).toBe("requested");
  });

  it("rejects a return request from someone who doesn't own the order", async () => {
    const { variant } = await makeVariant({ stock: 98 });
    const order = await deliveredOrder(variant.id, 2);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await expect(createReturnRequest(db, "00000000-0000-0000-0000-000000000000", order.id, [{ orderItemId: item!.id, quantity: 1, reason: "wrong_size" }])).rejects.toThrow(/does not belong to you/);
  });

  it("rejects returning more units than were ordered, across multiple requests", async () => {
    const { variant } = await makeVariant({ stock: 98 });
    const order = await deliveredOrder(variant.id, 2);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 2, reason: "wrong_size" }]);
    await expect(createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "changed_mind" }])).rejects.toThrow(/can return at most 0/);
  });

  it("rejects a request for an order that hasn't been delivered", async () => {
    const owner = { userId: null, name: "seed", role: "OWNER" as const };
    const { variant } = await makeVariant({ stock: 98 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await expect(createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "wrong_size" }])).rejects.toThrow(/hasn't been delivered/);
  });

  it("follows the return state machine and rejects invalid jumps", async () => {
    const staff = await makeStaff("ADMIN");
    const { variant } = await makeVariant({ stock: 98 });
    const order = await deliveredOrder(variant.id, 2);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "damaged" }]);

    await expect(updateReturnStatus(db, staff, rr.id, "received")).rejects.toThrow(/cannot move to/);
    await updateReturnStatus(db, staff, rr.id, "approved");
    await updateReturnStatus(db, staff, rr.id, "return_shipped");
    await updateReturnStatus(db, staff, rr.id, "received");
    await updateReturnStatus(db, staff, rr.id, "inspecting");
    expect(RETURN_TRANSITIONS.inspecting).toContain("approved_for_refund");
  });

  it("restocks only on a RESTOCK disposition — a damaged item never becomes sellable (brief §24)", async () => {
    const staff = await makeStaff("ADMIN");
    const { variant } = await makeVariant({ stock: 100 });
    const order = await deliveredOrder(variant.id, 2); // buy 2 -> stock 98
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "changed_mind" }]);
    const [ri] = await db.select().from(returnItems).where(eq(returnItems.returnRequestId, rr.id));

    await updateReturnStatus(db, staff, rr.id, "approved");
    await updateReturnStatus(db, staff, rr.id, "return_shipped");
    await updateReturnStatus(db, staff, rr.id, "received");
    await updateReturnStatus(db, staff, rr.id, "inspecting");
    await recordInspection(db, staff, ri!.id, { condition: "new", disposition: "restock" });

    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(99); // 98 + 1 restocked
  });

  it("does not restock a damaged/unsellable item", async () => {
    const staff = await makeStaff("ADMIN");
    const { variant } = await makeVariant({ stock: 100 });
    const order = await deliveredOrder(variant.id, 2); // stock -> 98
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "damaged" }]);
    const [ri] = await db.select().from(returnItems).where(eq(returnItems.returnRequestId, rr.id));

    await updateReturnStatus(db, staff, rr.id, "approved");
    await updateReturnStatus(db, staff, rr.id, "return_shipped");
    await updateReturnStatus(db, staff, rr.id, "received");
    await updateReturnStatus(db, staff, rr.id, "inspecting");
    await recordInspection(db, staff, ri!.id, { condition: "damaged", disposition: "damaged" });

    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(98); // unchanged — never made sellable again
  });

  it("rejects inspecting the same return item twice", async () => {
    const staff = await makeStaff("ADMIN");
    const { variant } = await makeVariant({ stock: 100 });
    const order = await deliveredOrder(variant.id, 1);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "other" }]);
    const [ri] = await db.select().from(returnItems).where(eq(returnItems.returnRequestId, rr.id));
    await updateReturnStatus(db, staff, rr.id, "approved");
    await updateReturnStatus(db, staff, rr.id, "return_shipped");
    await updateReturnStatus(db, staff, rr.id, "received");
    await updateReturnStatus(db, staff, rr.id, "inspecting");
    await recordInspection(db, staff, ri!.id, { condition: "new", disposition: "restock" });
    await expect(recordInspection(db, staff, ri!.id, { condition: "new", disposition: "restock" })).rejects.toThrow(/already been inspected/);
  });

  it("refunds only the returned item's proportional share, and tags the refund to the return request", async () => {
    const staff = await makeStaff("ADMIN");
    const { variant } = await makeVariant({ stock: 100, priceCents: 10_000 });
    const order = await deliveredOrder(variant.id, 2); // 2 units @ $100 = $200 line total
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "wrong_size" }]);
    const [ri] = await db.select().from(returnItems).where(eq(returnItems.returnRequestId, rr.id));

    await updateReturnStatus(db, staff, rr.id, "approved");
    await updateReturnStatus(db, staff, rr.id, "return_shipped");
    await updateReturnStatus(db, staff, rr.id, "received");
    await updateReturnStatus(db, staff, rr.id, "inspecting");
    await recordInspection(db, staff, ri!.id, { condition: "new", disposition: "restock" });
    await updateReturnStatus(db, staff, rr.id, "approved_for_refund");

    const result = await refundReturn(db, staff, rr.id);
    expect(result.amountCents).toBe(10_000); // half of the $200 line, matching the 1-of-2 returned quantity

    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.refundTotalCents).toBe(10_000);
    expect(o!.paymentStatus).toBe("partially_refunded");
  });

  it("a full refund never overwrites the order's real fulfillment progress (brief §42)", async () => {
    const staff = await makeStaff("ADMIN");
    const { variant } = await makeVariant({ stock: 100 });
    const order = await deliveredOrder(variant.id, 1); // the only unit — refunding it is a FULL refund
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "wrong_size" }]);
    const [ri] = await db.select().from(returnItems).where(eq(returnItems.returnRequestId, rr.id));

    await updateReturnStatus(db, staff, rr.id, "approved");
    await updateReturnStatus(db, staff, rr.id, "return_shipped");
    await updateReturnStatus(db, staff, rr.id, "received");
    await updateReturnStatus(db, staff, rr.id, "inspecting");
    await recordInspection(db, staff, ri!.id, { condition: "new", disposition: "restock" });
    await updateReturnStatus(db, staff, rr.id, "approved_for_refund");
    await refundReturn(db, staff, rr.id);

    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe("refunded");
    expect(o!.paymentStatus).toBe("refunded");
    expect(o!.fulfillmentStatus).toBe("delivered"); // the return_requests table is the source of truth for "was it returned", not this field
  });

  it("blocks a non-staff-permitted role from approving returns", async () => {
    const viewer = await makeStaff("VIEWER");
    const { variant } = await makeVariant({ stock: 98 });
    const order = await deliveredOrder(variant.id, 1);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rr = await createReturnRequest(db, order.customerId!, order.id, [{ orderItemId: item!.id, quantity: 1, reason: "other" }]);
    await expect(updateReturnStatus(db, viewer, rr.id, "approved")).rejects.toThrow(/cannot perform orders:write/);
  });
});
