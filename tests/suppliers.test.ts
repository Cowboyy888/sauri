/** Suppliers and supplier-product relationships (brief §9-12, §50). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { createSupplier, updateSupplier, setSupplierStatus, upsertSupplierProduct, listSuppliersForVariant, getSupplier } from "@/lib/purchasing/suppliers";
import { ForbiddenError } from "@/lib/errors";

const owner = { userId: null, name: "seed", role: "OWNER" as const };
const admin = { userId: null, name: "admin", role: "ADMIN" as const };
const inventoryRole = { userId: null, name: "inv", role: "INVENTORY" as const };
const sales = { userId: null, name: "sales", role: "SALES" as const };

describe("suppliers (brief §9-11)", () => {
  beforeEach(resetDb);

  it("ADMIN can create a supplier with the full field set", async () => {
    const s = await createSupplier(db, admin, { name: "Golden Chain Co", company: "Golden Chain Co Ltd", contactPerson: "Mei Lin", email: "mei@goldenchain.example", leadTimeDays: 14, minimumOrderCents: 50_000, currency: "USD" });
    expect(s.name).toBe("Golden Chain Co");
    expect(s.status).toBe("ACTIVE");
    expect(s.leadTimeDays).toBe(14);
  });

  it("rejects a duplicate supplier name", async () => {
    await createSupplier(db, owner, { name: "Dupe Co" });
    await expect(createSupplier(db, owner, { name: "Dupe Co" })).rejects.toThrow(/already exists/);
  });

  it("INVENTORY and SALES cannot create or edit suppliers (purchasing:write)", async () => {
    await expect(createSupplier(db, inventoryRole, { name: "X" })).rejects.toThrow(ForbiddenError);
    await expect(createSupplier(db, sales, { name: "Y" })).rejects.toThrow(ForbiddenError);
    const s = await createSupplier(db, owner, { name: "Z" });
    await expect(updateSupplier(db, inventoryRole, s.id, { name: "Z2" })).rejects.toThrow(ForbiddenError);
  });

  it("supports the ACTIVE/INACTIVE/BLOCKED status lifecycle", async () => {
    const s = await createSupplier(db, owner, { name: "Lifecycle Co" });
    const blocked = await setSupplierStatus(db, owner, s.id, "BLOCKED");
    expect(blocked.status).toBe("BLOCKED");
  });
});

describe("supplier-product relationships (brief §12)", () => {
  beforeEach(resetDb);

  it("a variant can have multiple suppliers, and one can be marked preferred", async () => {
    const { variant } = await makeVariant({ stock: 0 });
    const a = await createSupplier(db, owner, { name: "Supplier A" });
    const b = await createSupplier(db, owner, { name: "Supplier B" });
    await upsertSupplierProduct(db, owner, { supplierId: a.id, variantId: variant.id, purchasePriceCents: 4_000, preferredSupplier: true });
    await upsertSupplierProduct(db, owner, { supplierId: b.id, variantId: variant.id, purchasePriceCents: 4_500 });

    const list = await listSuppliersForVariant(db, variant.id);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.supplierId === a.id)?.preferredSupplier).toBe(true);
    expect(list.find((x) => x.supplierId === b.id)?.preferredSupplier).toBe(false);
  });

  it("marking a new preferred supplier un-prefers the previous one (never two preferred at once)", async () => {
    const { variant } = await makeVariant({ stock: 0 });
    const a = await createSupplier(db, owner, { name: "Supplier A" });
    const b = await createSupplier(db, owner, { name: "Supplier B" });
    await upsertSupplierProduct(db, owner, { supplierId: a.id, variantId: variant.id, purchasePriceCents: 4_000, preferredSupplier: true });
    await upsertSupplierProduct(db, owner, { supplierId: b.id, variantId: variant.id, purchasePriceCents: 4_500, preferredSupplier: true });
    const list = await listSuppliersForVariant(db, variant.id);
    expect(list.filter((x) => x.preferredSupplier)).toHaveLength(1);
    expect(list.find((x) => x.preferredSupplier)?.supplierId).toBe(b.id);
  });

  it("a product can have multiple suppliers reflected on the supplier's own profile", async () => {
    const { variant: v1 } = await makeVariant({ stock: 0, code: "AAA" });
    const { variant: v2 } = await makeVariant({ stock: 0, code: "BBB" });
    const supplier = await createSupplier(db, owner, { name: "Multi Product Co" });
    await upsertSupplierProduct(db, owner, { supplierId: supplier.id, variantId: v1.id, purchasePriceCents: 1_000 });
    await upsertSupplierProduct(db, owner, { supplierId: supplier.id, variantId: v2.id, purchasePriceCents: 2_000 });
    const profile = await getSupplier(db, supplier.id);
    expect(profile!.products).toHaveLength(2);
  });
});

afterAll(() => pool.end());
