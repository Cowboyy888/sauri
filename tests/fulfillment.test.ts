/** Fulfillment stage transitions, packages, multi-package partial shipment, and tracking (brief §2, §40, §45). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { advanceFulfillmentStage, createPackage, setPackageStatus, trackingUrlFor } from "@/lib/fulfillment/service";
import { orders, orderItems, packages } from "@/lib/db/schema";

async function paidOrder(variantId: string, quantity = 2) {
  const owner = { userId: null, name: "seed", role: "OWNER" as const };
  return placeOrder(db, { lines: [{ variantId, quantity }], customer: buyer, status: "paid", channel: "MANUAL_ORDER" }, owner);
}

describe("fulfillment stages", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("moves paid -> processing -> picking -> packing -> ready_to_ship, one stage at a time", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 20 });
    const order = await paidOrder(variant.id, 2);

    await advanceFulfillmentStage(db, staff, order.id, "processing");
    let [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.fulfillmentStatus).toBe("processing");
    expect(o!.status).toBe("processing"); // lifecycle synced from "paid"

    await advanceFulfillmentStage(db, staff, order.id, "picking");
    await advanceFulfillmentStage(db, staff, order.id, "packing");
    await advanceFulfillmentStage(db, staff, order.id, "ready_to_ship");
    [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.fulfillmentStatus).toBe("ready_to_ship");
  });

  it("rejects skipping a stage or moving backward", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 20 });
    const order = await paidOrder(variant.id, 1);
    await expect(advanceFulfillmentStage(db, staff, order.id, "packing")).rejects.toThrow(/cannot move to/);
    await advanceFulfillmentStage(db, staff, order.id, "processing");
    await expect(advanceFulfillmentStage(db, staff, order.id, "ready_to_ship")).rejects.toThrow(/cannot move to/);
  });

  it("DELIVERED -> PICKING is rejected (brief §2 example, generalized)", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 20 });
    const order = await paidOrder(variant.id, 1);
    await advanceFulfillmentStage(db, staff, order.id, "processing");
    await advanceFulfillmentStage(db, staff, order.id, "picking");
    await advanceFulfillmentStage(db, staff, order.id, "packing");
    await advanceFulfillmentStage(db, staff, order.id, "ready_to_ship");
    const [pkg] = await createPackageForAllItems(db, staff, order.id);
    await setPackageStatus(db, staff, pkg!.id, "delivered");
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.fulfillmentStatus).toBe("delivered");
    await expect(advanceFulfillmentStage(db, staff, order.id, "picking")).rejects.toThrow();
  });

  it("multi-package: order is partially_shipped until every package ships, then shipped, then delivered", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 20 });
    const order = await paidOrder(variant.id, 3);
    await advanceFulfillmentStage(db, staff, order.id, "processing");
    await advanceFulfillmentStage(db, staff, order.id, "picking");
    await advanceFulfillmentStage(db, staff, order.id, "packing");
    await advanceFulfillmentStage(db, staff, order.id, "ready_to_ship");

    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const pkg1 = await createPackage(db, staff, order.id, { items: [{ orderItemId: item!.id, quantity: 2 }], carrier: "DHL", trackingNumber: "DHL1" });
    const pkg2 = await createPackage(db, staff, order.id, { items: [{ orderItemId: item!.id, quantity: 1 }], carrier: "DHL", trackingNumber: "DHL2" });
    expect(pkg1.packageNumber).toBe(1);
    expect(pkg2.packageNumber).toBe(2);

    await setPackageStatus(db, staff, pkg1.id, "shipped");
    let [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.fulfillmentStatus).toBe("partially_shipped");
    expect(o!.status).toBe("processing"); // lifecycle stays put until fully shipped

    await setPackageStatus(db, staff, pkg2.id, "shipped");
    [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.fulfillmentStatus).toBe("shipped");
    expect(o!.status).toBe("shipped");

    await setPackageStatus(db, staff, pkg1.id, "delivered");
    [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.fulfillmentStatus).toBe("shipped"); // pkg2 not delivered yet — order isn't fully delivered

    await setPackageStatus(db, staff, pkg2.id, "delivered");
    [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.fulfillmentStatus).toBe("delivered");
    expect(o!.status).toBe("delivered");
  });

  it("cannot package more units of a line than remain unpackaged", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 20 });
    const order = await paidOrder(variant.id, 2);
    await advanceFulfillmentStage(db, staff, order.id, "processing");
    await advanceFulfillmentStage(db, staff, order.id, "picking");
    await advanceFulfillmentStage(db, staff, order.id, "packing");
    await advanceFulfillmentStage(db, staff, order.id, "ready_to_ship");
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await createPackage(db, staff, order.id, { items: [{ orderItemId: item!.id, quantity: 2 }] });
    await expect(createPackage(db, staff, order.id, { items: [{ orderItemId: item!.id, quantity: 1 }] })).rejects.toThrow(/remain to be packaged/);
  });

  it("generates known-carrier tracking URLs and falls back to a custom URL", () => {
    expect(trackingUrlFor("UPS", "1Z999")).toContain("ups.com");
    expect(trackingUrlFor("FedEx", "999")).toContain("fedex.com");
    expect(trackingUrlFor("Local Courier", "ABC", "https://example.com/track/ABC")).toBe("https://example.com/track/ABC");
    expect(trackingUrlFor("Local Courier", "ABC")).toBeNull();
  });

  it("INVENTORY can advance fulfillment; SALES cannot", async () => {
    const sales = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 20 });
    const order = await paidOrder(variant.id, 1);
    await expect(advanceFulfillmentStage(db, sales, order.id, "processing")).rejects.toThrow(/cannot perform inventory:write/);
  });
});

async function createPackageForAllItems(dbh: typeof db, staff: Awaited<ReturnType<typeof makeStaff>>, orderId: string) {
  const items = await dbh.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const pkg = await createPackage(dbh, staff, orderId, { items: items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })), carrier: "DHL", trackingNumber: "T1" });
  await setPackageStatus(dbh, staff, pkg.id, "shipped");
  return [pkg];
}
void packages;
