/** Reorder suggestions, incoming inventory, supplier & purchase analytics (brief §30-36, §55). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, ALL_TIME } from "./helpers";
import { createSupplier, upsertSupplierProduct } from "@/lib/purchasing/suppliers";
import { createPurchaseOrder, setPurchaseOrderStatus, getPurchaseOrder } from "@/lib/purchasing/orders";
import { receivePurchaseOrder } from "@/lib/purchasing/receiving";
import { getReorderSuggestions, getIncomingInventory, setTargetStockLevel } from "@/lib/admin/purchasing";
import { getSupplierPerformance, getPurchaseAnalytics } from "@/lib/analytics/purchasing";
import { inventory } from "@/lib/db/schema";

const owner = { userId: null, name: "seed", role: "OWNER" as const };

describe("brief §55: reorder suggestion formula", () => {
  beforeEach(resetDb);

  it("available=8, reorder level=10, incoming=0, target=50 => suggested 42", async () => {
    const { variant } = await makeVariant({ stock: 8, reorder: 10 });
    await setTargetStockLevel(db, owner, variant.id, 50);
    const suggestions = await getReorderSuggestions(db);
    const row = suggestions.find((s) => s.variantId === variant.id);
    expect(row).toBeTruthy();
    expect(row!.availableStock).toBe(8);
    expect(row!.reorderLevel).toBe(10);
    expect(row!.incomingQuantity).toBe(0);
    expect(row!.suggestedQuantity).toBe(42);
  });

  it("subtracts incoming quantity from an approved purchase order", async () => {
    const { variant } = await makeVariant({ stock: 5, reorder: 10 });
    await setTargetStockLevel(db, owner, variant.id, 50);
    const supplier = await createSupplier(db, owner, { name: "Incoming Test Co" });
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 20, unitCostCents: 1_000 }] });
    await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
    await setPurchaseOrderStatus(db, owner, po.id, "APPROVED");
    const suggestions = await getReorderSuggestions(db);
    const row = suggestions.find((s) => s.variantId === variant.id)!;
    expect(row.incomingQuantity).toBe(20);
    expect(row.suggestedQuantity).toBe(50 - 5 - 20); // 25
  });

  it("a DRAFT purchase order does not count as incoming (not yet committed)", async () => {
    const { variant } = await makeVariant({ stock: 5, reorder: 10 });
    const supplier = await createSupplier(db, owner, { name: "Draft PO Co" });
    await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 20, unitCostCents: 1_000 }] });
    const suggestions = await getReorderSuggestions(db);
    const row = suggestions.find((s) => s.variantId === variant.id)!;
    expect(row.incomingQuantity).toBe(0);
  });

  it("falls back to reorderLevel x 5 when no target stock level is set", async () => {
    const { variant } = await makeVariant({ stock: 2, reorder: 10 });
    const suggestions = await getReorderSuggestions(db);
    const row = suggestions.find((s) => s.variantId === variant.id)!;
    expect(row.targetStockLevel).toBeNull();
    expect(row.suggestedQuantity).toBe(10 * 5 - 2);
  });
});

describe("incoming inventory (brief §33)", () => {
  beforeEach(resetDb);

  it("lists remaining quantity for ordered POs, and never counts it as sellable stock", async () => {
    const { variant } = await makeVariant({ stock: 0 });
    const supplier = await createSupplier(db, owner, { name: "Incoming List Co" });
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 30, unitCostCents: 1_000 }] });
    await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
    await setPurchaseOrderStatus(db, owner, po.id, "APPROVED");
    await setPurchaseOrderStatus(db, owner, po.id, "ORDERED");
    const incoming = await getIncomingInventory(db);
    const row = incoming.find((i) => i.poId === po.id)!;
    expect(row.remaining).toBe(30);
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(0); // still not sellable
  });
});

describe("supplier and purchase analytics (brief §34-35)", () => {
  beforeEach(resetDb);

  it("only calculates supplier metrics from real receiving data", async () => {
    const { variant } = await makeVariant({ stock: 0 });
    const supplier = await createSupplier(db, owner, { name: "Analytics Supplier" });
    await upsertSupplierProduct(db, owner, { supplierId: supplier.id, variantId: variant.id, purchasePriceCents: 4_000 });
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 50, unitCostCents: 4_000 }] });
    await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
    await setPurchaseOrderStatus(db, owner, po.id, "APPROVED");
    await setPurchaseOrderStatus(db, owner, po.id, "ORDERED");
    const full = await getPurchaseOrder(db, po.id);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: full!.items[0]!.id, acceptedQuantity: 45, rejectedQuantity: 5 }] });

    const perf = await getSupplierPerformance(db, ALL_TIME);
    const row = perf.find((p) => p.supplierId === supplier.id)!;
    expect(row.unitsPurchased).toBe(50); // accepted + rejected
    expect(row.rejectedQuantity).toBe(5);
    expect(row.totalSpendCents).toBe(50 * 4_000);

    const purchases = await getPurchaseAnalytics(db, ALL_TIME);
    expect(purchases.purchaseOrders).toBeGreaterThanOrEqual(1);
    expect(purchases.purchaseSpendCents).toBeGreaterThanOrEqual(50 * 4_000);
  });
});

afterAll(() => pool.end());
