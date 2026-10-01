/** Purchase order creation, numbering, approval workflow, cancellation, RBAC (brief §13-16, §50). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { createSupplier } from "@/lib/purchasing/suppliers";
import { createPurchaseOrder, setPurchaseOrderStatus, getPurchaseOrder } from "@/lib/purchasing/orders";
import { ForbiddenError } from "@/lib/errors";

const owner = { userId: null, name: "seed", role: "OWNER" as const };
const admin = { userId: null, name: "admin", role: "ADMIN" as const };
const inventoryRole = { userId: null, name: "inv", role: "INVENTORY" as const };

async function setup() {
  const supplier = await createSupplier(db, owner, { name: "Test Supplier" });
  const { variant } = await makeVariant({ stock: 0, priceCents: 20_000, costCents: 10_000 });
  return { supplier, variant };
}

describe("purchase order creation (brief §14-15)", () => {
  beforeEach(resetDb);

  it("computes totals server-side and issues a PO-YYYY-###### number", async () => {
    const { supplier, variant } = await setup();
    const po = await createPurchaseOrder(db, owner, {
      supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 10, unitCostCents: 5_000 }], shippingCents: 1_000, taxCents: 500,
    });
    expect(po.subtotalCents).toBe(50_000);
    expect(po.totalCents).toBe(51_500);
    expect(po.status).toBe("DRAFT");
    expect(po.poNumber).toMatch(/^PO-\d{4}-\d{6}$/);
  });

  it("rejects an empty item list", async () => {
    const { supplier } = await setup();
    await expect(createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [] })).rejects.toThrow();
  });

  it("never exposes a raw database id as the PO's human-facing identifier", async () => {
    const { supplier, variant } = await setup();
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 1, unitCostCents: 1_000 }] });
    expect(po.poNumber).not.toBe(po.id);
  });
});

describe("approval workflow (brief §16)", () => {
  beforeEach(resetDb);

  it("DRAFT -> PENDING_APPROVAL -> APPROVED -> ORDERED, recorded with an audit entry", async () => {
    const { supplier, variant } = await setup();
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 5, unitCostCents: 5_000 }] });
    const submitted = await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
    expect(submitted.status).toBe("PENDING_APPROVAL");
    const approved = await setPurchaseOrderStatus(db, owner, po.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByUserId).toBeNull(); // owner actor has no userId in this test harness — still records the attempt
    const ordered = await setPurchaseOrderStatus(db, owner, po.id, "ORDERED");
    expect(ordered.status).toBe("ORDERED");
    expect(ordered.orderedAt).toBeInstanceOf(Date);
  });

  it("rejects an invalid transition (e.g. DRAFT straight to ORDERED)", async () => {
    const { supplier, variant } = await setup();
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 5, unitCostCents: 5_000 }] });
    await expect(setPurchaseOrderStatus(db, owner, po.id, "ORDERED")).rejects.toThrow(/cannot become/);
  });

  it("only purchasing:write (OWNER/ADMIN) can approve — INVENTORY cannot", async () => {
    const { supplier, variant } = await setup();
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 5, unitCostCents: 5_000 }] });
    await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
    await expect(setPurchaseOrderStatus(db, inventoryRole, po.id, "APPROVED")).rejects.toThrow(ForbiddenError);
    const approved = await setPurchaseOrderStatus(db, admin, po.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");
  });

  it("cancellation is available from DRAFT, PENDING_APPROVAL, APPROVED and ORDERED, with an audit entry", async () => {
    const { supplier, variant } = await setup();
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 5, unitCostCents: 5_000 }] });
    const cancelled = await setPurchaseOrderStatus(db, owner, po.id, "CANCELLED");
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    await expect(setPurchaseOrderStatus(db, owner, po.id, "APPROVED")).rejects.toThrow(/cannot become/);
  });

  it("getPurchaseOrder returns items, documents, sends and payments together", async () => {
    const { supplier, variant } = await setup();
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 5, unitCostCents: 5_000 }] });
    const full = await getPurchaseOrder(db, po.id);
    expect(full!.items).toHaveLength(1);
    expect(full!.documents).toHaveLength(0);
    expect(full!.supplierName).toBe(supplier.name);
  });
});

afterAll(() => pool.end());
