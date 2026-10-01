/**
 * Suppliers and supplier-product relationships (brief §9-12). Extends the Phase 1 `suppliers` table (which
 * only ever had name/email/phone, populated lazily by `restock()`'s free-text field) rather than creating a
 * second supplier system — see docs/PHASE_8_AUDIT.md and docs/SUPPLIERS.md.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { productVariants, products, purchaseOrders, suppliers, supplierProducts } from "../db/schema";
import { ValidationError, NotFoundError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { n, rows } from "../admin/sql";

export type SupplierRow = typeof suppliers.$inferSelect;

export type NewSupplier = {
  name: string; company?: string; contactPerson?: string; email?: string; phone?: string;
  addressLine1?: string; addressLine2?: string; city?: string; postalCode?: string; country?: string;
  website?: string; paymentTerms?: string; currency?: string; leadTimeDays?: number | null; minimumOrderCents?: number | null; notes?: string;
};

function clean(v: NewSupplier) {
  return {
    name: v.name.trim(), company: v.company?.trim() || null, contactPerson: v.contactPerson?.trim() || null,
    email: v.email?.trim().toLowerCase() || null, phone: v.phone?.trim() || null,
    addressLine1: v.addressLine1?.trim() || null, addressLine2: v.addressLine2?.trim() || null, city: v.city?.trim() || null,
    postalCode: v.postalCode?.trim() || null, country: v.country?.trim() || null, website: v.website?.trim() || null,
    paymentTerms: v.paymentTerms?.trim() || null, currency: (v.currency || "USD").trim().toUpperCase(),
    leadTimeDays: v.leadTimeDays ?? null, minimumOrderCents: v.minimumOrderCents ?? null, notes: v.notes?.trim() || null,
  };
}

export async function createSupplier(db: Db, actor: Actor, input: NewSupplier): Promise<SupplierRow> {
  assertCan(actor, "purchasing:write");
  if (!input.name.trim()) throw new ValidationError("Enter a supplier name.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(suppliers).values(clean(input)).onConflictDoNothing().returning();
    if (!row) throw new ValidationError("A supplier with that name already exists.");
    await audit(tx, actor, "Created supplier", "supplier", row.name, undefined, { name: row.name });
    return row;
  });
}

export type SupplierPatch = Partial<NewSupplier> & { status?: "ACTIVE" | "INACTIVE" | "BLOCKED" };
export async function updateSupplier(db: Db, actor: Actor, id: string, patch: SupplierPatch): Promise<SupplierRow> {
  assertCan(actor, "purchasing:write");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
    if (!before) throw new NotFoundError("Supplier not found.");
    const set: Record<string, unknown> = { ...clean({ ...before, ...patch } as NewSupplier) };
    if (patch.status) set.status = patch.status;
    const [after] = await tx.update(suppliers).set(set).where(eq(suppliers.id, id)).returning();
    await audit(tx, actor, "Updated supplier", "supplier", before.name, before, after);
    return after!;
  });
}

export async function setSupplierStatus(db: Db, actor: Actor, id: string, status: "ACTIVE" | "INACTIVE" | "BLOCKED") {
  assertCan(actor, "purchasing:write");
  const [row] = await db.update(suppliers).set({ status }).where(eq(suppliers.id, id)).returning();
  if (!row) throw new NotFoundError("Supplier not found.");
  await audit(db, actor, "Changed supplier status", "supplier", row.name, undefined, { status });
  return row;
}

export async function listSuppliers(db: DbOrTx) {
  const res = await rows<Record<string, string | null>>(db, sql`
    select s.*, coalesce(sp.products, 0) as products, coalesce(po.po_count, 0) as po_count,
      coalesce(po.total_spend, 0) as total_spend, coalesce(po.outstanding, 0) as outstanding
    from suppliers s
    left join (select supplier_id, count(*) as products from supplier_products group by supplier_id) sp on sp.supplier_id = s.id
    left join (
      select supplier_id, count(*) as po_count, coalesce(sum(total_cents),0) as total_spend,
        coalesce(sum(total_cents - amount_paid_cents) filter (where status <> 'CANCELLED'), 0) as outstanding
      from purchase_orders group by supplier_id
    ) po on po.supplier_id = s.id
    order by s.name`);
  return res.map((r) => ({
    id: r.id!, name: r.name!, company: r.company, contactPerson: r.contact_person, email: r.email, phone: r.phone,
    country: r.country, status: r.status!, products: n(r.products), purchaseOrders: n(r.po_count), totalSpendCents: n(r.total_spend), outstandingCents: n(r.outstanding),
  }));
}

export async function getSupplier(db: DbOrTx, id: string) {
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!supplier) return null;
  const productRows = await db.select({
    id: supplierProducts.id, variantId: supplierProducts.variantId, sku: productVariants.sku, productId: products.id, productName: products.name,
    supplierSku: supplierProducts.supplierSku, purchasePriceCents: supplierProducts.purchasePriceCents, currency: supplierProducts.currency,
    minimumOrderQuantity: supplierProducts.minimumOrderQuantity, leadTimeDays: supplierProducts.leadTimeDays, preferredSupplier: supplierProducts.preferredSupplier,
    lastPurchasePriceCents: supplierProducts.lastPurchasePriceCents, lastPurchaseDate: supplierProducts.lastPurchaseDate,
  }).from(supplierProducts).innerJoin(productVariants, eq(productVariants.id, supplierProducts.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(supplierProducts.supplierId, id)).orderBy(productVariants.sku);
  const poRows = await db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status, orderDate: purchaseOrders.orderDate, totalCents: purchaseOrders.totalCents, paymentStatus: purchaseOrders.paymentStatus })
    .from(purchaseOrders).where(eq(purchaseOrders.supplierId, id)).orderBy(desc(purchaseOrders.orderDate)).limit(100);
  const [stats] = await rows<{ total_spend: string; orders: string; avg_cost: string | null; last_purchase: string | null }>(db, sql`
    select coalesce(sum(total_cents),0) as total_spend, count(*) as orders,
      (select avg(unit_cost_cents) from purchase_order_items i join purchase_orders o on o.id = i.purchase_order_id where o.supplier_id = ${id}) as avg_cost,
      max(order_date) as last_purchase
    from purchase_orders where supplier_id = ${id} and status <> 'CANCELLED'`);
  return {
    supplier, products: productRows, purchaseOrders: poRows,
    totalSpendCents: n(stats?.total_spend), orderCount: n(stats?.orders), averagePurchaseCostCents: stats?.avg_cost != null ? Math.round(Number(stats.avg_cost)) : null,
    lastPurchaseAt: stats?.last_purchase ? new Date(stats.last_purchase) : null,
  };
}

/* --------------------------------------------------------------------- supplier-product relationships */
export type NewSupplierProduct = {
  supplierId: string; variantId: string; supplierSku?: string; purchasePriceCents: number; currency?: string;
  minimumOrderQuantity?: number | null; leadTimeDays?: number | null; preferredSupplier?: boolean;
};
export async function upsertSupplierProduct(db: Db, actor: Actor, input: NewSupplierProduct) {
  assertCan(actor, "purchasing:write");
  if (input.purchasePriceCents < 0) throw new ValidationError("Purchase price can't be negative.");
  return db.transaction(async (tx) => {
    if (input.preferredSupplier) await tx.update(supplierProducts).set({ preferredSupplier: false }).where(eq(supplierProducts.variantId, input.variantId));
    const [row] = await tx.insert(supplierProducts).values({
      supplierId: input.supplierId, variantId: input.variantId, supplierSku: input.supplierSku || null, purchasePriceCents: input.purchasePriceCents,
      currency: (input.currency || "USD").toUpperCase(), minimumOrderQuantity: input.minimumOrderQuantity ?? null, leadTimeDays: input.leadTimeDays ?? null,
      preferredSupplier: !!input.preferredSupplier,
    }).onConflictDoUpdate({
      target: [supplierProducts.supplierId, supplierProducts.variantId],
      set: { supplierSku: input.supplierSku || null, purchasePriceCents: input.purchasePriceCents, currency: (input.currency || "USD").toUpperCase(), minimumOrderQuantity: input.minimumOrderQuantity ?? null, leadTimeDays: input.leadTimeDays ?? null, preferredSupplier: !!input.preferredSupplier, updatedAt: new Date() },
    }).returning();
    await audit(tx, actor, "Set supplier price", "supplier_product", row!.id, undefined, { supplierId: input.supplierId, variantId: input.variantId, purchasePriceCents: input.purchasePriceCents });
    return row!;
  });
}

export async function removeSupplierProduct(db: Db, actor: Actor, id: string) {
  assertCan(actor, "purchasing:write");
  const [row] = await db.delete(supplierProducts).where(eq(supplierProducts.id, id)).returning();
  if (row) await audit(db, actor, "Removed supplier price", "supplier_product", id, row, undefined);
}

/** For a given variant: every supplier that offers it (brief §40's price-comparison table). Never picks one
 *  automatically — an authorized user chooses when creating a PO. */
export async function listSuppliersForVariant(db: DbOrTx, variantId: string) {
  const res = await db.select({
    id: supplierProducts.id, supplierId: supplierProducts.supplierId, supplierName: suppliers.name, supplierStatus: suppliers.status,
    purchasePriceCents: supplierProducts.purchasePriceCents, currency: supplierProducts.currency, minimumOrderQuantity: supplierProducts.minimumOrderQuantity,
    leadTimeDays: supplierProducts.leadTimeDays, preferredSupplier: supplierProducts.preferredSupplier,
    lastPurchasePriceCents: supplierProducts.lastPurchasePriceCents, lastPurchaseDate: supplierProducts.lastPurchaseDate,
  }).from(supplierProducts).innerJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
    .where(eq(supplierProducts.variantId, variantId)).orderBy(desc(supplierProducts.preferredSupplier), supplierProducts.purchasePriceCents);
  return res;
}

export async function getPreferredSupplierProduct(db: DbOrTx, variantId: string) {
  const [row] = await db.select().from(supplierProducts).where(and(eq(supplierProducts.variantId, variantId), eq(supplierProducts.preferredSupplier, true)));
  if (row) return row;
  const [any] = await db.select().from(supplierProducts).where(eq(supplierProducts.variantId, variantId)).orderBy(supplierProducts.purchasePriceCents).limit(1);
  return any ?? null;
}
