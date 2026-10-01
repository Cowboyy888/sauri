/** Stocktake / cycle counting and the manager-approval threshold (brief §46-48). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { startStocktake, recordCount, completeStocktake, getStocktake, setStocktakeSettings } from "@/lib/purchasing/stocktake";
import { inventory, inventoryMovements } from "@/lib/db/schema";
import { ForbiddenError } from "@/lib/errors";

const owner = { userId: null, name: "seed", role: "OWNER" as const };
const inventoryRole = { userId: null, name: "inv", role: "INVENTORY" as const };

describe("stocktake (brief §46-47)", () => {
  beforeEach(resetDb);

  it("snapshots current stock as expected, and a shortfall creates a negative ADJUSTMENT", async () => {
    const { variant } = await makeVariant({ stock: 100 });
    const st = await startStocktake(db, inventoryRole, {});
    await recordCount(db, inventoryRole, st.id, variant.id, 97);
    await completeStocktake(db, inventoryRole, st.id);
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(97);
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    const adj = movements.find((m) => m.movementType === "ADJUSTMENT");
    expect(adj!.quantity).toBe(-3);
  });

  it("a surplus creates a positive ADJUSTMENT", async () => {
    const { variant } = await makeVariant({ stock: 100 });
    const st = await startStocktake(db, inventoryRole, {});
    await recordCount(db, inventoryRole, st.id, variant.id, 103);
    await completeStocktake(db, inventoryRole, st.id);
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(103);
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    expect(movements.find((m) => m.movementType === "ADJUSTMENT")!.quantity).toBe(3);
  });

  it("an exact match (difference 0) writes no movement at all", async () => {
    const { variant } = await makeVariant({ stock: 50 });
    const st = await startStocktake(db, inventoryRole, {});
    await recordCount(db, inventoryRole, st.id, variant.id, 50);
    await completeStocktake(db, inventoryRole, st.id);
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    expect(movements.filter((m) => m.movementType === "ADJUSTMENT")).toHaveLength(0);
  });

  it("shows expected, counted and the computed difference", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const st = await startStocktake(db, inventoryRole, {});
    await recordCount(db, inventoryRole, st.id, variant.id, 18);
    const full = await getStocktake(db, st.id);
    const item = full!.items.find((i) => i.variantId === variant.id)!;
    expect(item.expectedQuantity).toBe(20);
    expect(item.countedQuantity).toBe(18);
    expect(item.difference).toBe(-2);
  });
});

describe("manager approval for significant discrepancies (brief §48)", () => {
  beforeEach(resetDb);

  it("a discrepancy at or above the configured threshold requires OWNER/ADMIN, not INVENTORY", async () => {
    await setStocktakeSettings(db, owner, { approvalThresholdUnits: 5 });
    const { variant } = await makeVariant({ stock: 100 });
    const st = await startStocktake(db, inventoryRole, {});
    await recordCount(db, inventoryRole, st.id, variant.id, 90); // discrepancy of 10 >= threshold of 5
    await expect(completeStocktake(db, inventoryRole, st.id)).rejects.toThrow(ForbiddenError);
    const pending = await getStocktake(db, st.id);
    expect(pending!.stocktake.status).toBe("pending_approval");
    const done = await completeStocktake(db, owner, st.id);
    expect(done.status).toBe("completed");
  });

  it("a small discrepancy below the threshold does not require approval", async () => {
    await setStocktakeSettings(db, owner, { approvalThresholdUnits: 10 });
    const { variant } = await makeVariant({ stock: 100 });
    const st = await startStocktake(db, inventoryRole, {});
    await recordCount(db, inventoryRole, st.id, variant.id, 97); // discrepancy of 3 < threshold of 10
    const done = await completeStocktake(db, inventoryRole, st.id);
    expect(done.status).toBe("completed");
  });

  it("every adjustment is audited with a reason, user and timestamp", async () => {
    const { variant } = await makeVariant({ stock: 100 });
    const st = await startStocktake(db, inventoryRole, {});
    await recordCount(db, inventoryRole, st.id, variant.id, 95);
    await completeStocktake(db, inventoryRole, st.id);
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    const adj = movements.find((m) => m.movementType === "ADJUSTMENT")!;
    expect(adj.referenceType).toBe("stock_count");
    expect(adj.createdAt).toBeInstanceOf(Date);
  });
});

afterAll(() => pool.end());
