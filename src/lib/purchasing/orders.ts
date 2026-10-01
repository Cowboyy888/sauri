/**
 * Purchase orders (brief §13-18, §41-42). Every total is computed server-side (brief §14) — the browser
 * only ever sends variant ids, quantities and unit costs. `po_number` reuses the exact sequence-backed
 * default pattern `orders.order_number` already uses (see schema.ts). See docs/PURCHASING.md.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import {
  productVariants, products, purchaseDocuments, purchaseOrderItems, purchaseOrders, purchaseOrderSends,
  purchasePayments, suppliers,
} from "../db/schema";
import { ValidationError, NotFoundError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { emailProvider, purchaseOrderEmail } from "../email/provider";
import { formatMoney } from "../money";
import { n, rows } from "../admin/sql";

export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderItemInput = { variantId: string; supplierSku?: string; quantity: number; unitCostCents: number; discountCents?: number };
export type NewPurchaseOrder = {
  supplierId: string; expectedDeliveryDate?: Date | null; currency?: string; paymentTerms?: string; notes?: string;
  discountCents?: number; shippingCents?: number; taxCents?: number; dueDate?: Date | null;
  items: PurchaseOrderItemInput[];
};

function lineTotal(i: PurchaseOrderItemInput) {
  return i.quantity * i.unitCostCents - (i.discountCents ?? 0);
}
function computeTotals(items: PurchaseOrderItemInput[], discountCents: number, shippingCents: number, taxCents: number) {
  const subtotalCents = items.reduce((a, i) => a + i.quantity * i.unitCostCents, 0);
  const totalCents = subtotalCents - discountCents + shippingCents + taxCents;
  return { subtotalCents, totalCents };
}

function validateItems(items: PurchaseOrderItemInput[]) {
  if (!items.length) throw new ValidationError("Add at least one item.");
  for (const i of items) {
    if (!Number.isInteger(i.quantity) || i.quantity <= 0) throw new ValidationError("Quantity must be a whole number above zero.");
    if (!Number.isInteger(i.unitCostCents) || i.unitCostCents < 0) throw new ValidationError("Unit cost must be zero or more.");
    if (i.discountCents != null && (i.discountCents < 0 || i.discountCents > i.quantity * i.unitCostCents)) throw new ValidationError("Line discount can't exceed the line total.");
  }
}

export async function createPurchaseOrder(db: Db, actor: Actor, input: NewPurchaseOrder): Promise<PurchaseOrderRow> {
  assertCan(actor, "purchasing:write");
  validateItems(input.items);
  const discountCents = input.discountCents ?? 0, shippingCents = input.shippingCents ?? 0, taxCents = input.taxCents ?? 0;
  if (discountCents < 0 || shippingCents < 0 || taxCents < 0) throw new ValidationError("Amounts can't be negative.");
  return db.transaction(async (tx) => {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw new ValidationError("Choose a supplier.");
    const variantIds = [...new Set(input.items.map((i) => i.variantId))];
    const variantRows = await tx.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.id, variantIds));
    const byId = new Map(variantRows.map((v) => [v.id, v]));
    for (const i of input.items) if (!byId.has(i.variantId)) throw new ValidationError("One of the selected variants no longer exists.");
    const { subtotalCents, totalCents } = computeTotals(input.items, discountCents, shippingCents, taxCents);
    const [po] = await tx.insert(purchaseOrders).values({
      supplierId: input.supplierId, expectedDeliveryDate: input.expectedDeliveryDate ?? null, currency: input.currency ?? supplier.currency,
      paymentTerms: input.paymentTerms ?? supplier.paymentTerms ?? null, notes: input.notes ?? "",
      subtotalCents, discountCents, shippingCents, taxCents, totalCents, dueDate: input.dueDate ?? null, createdByUserId: actor.userId,
    }).returning();
    await tx.insert(purchaseOrderItems).values(input.items.map((i) => ({
      purchaseOrderId: po!.id, productId: byId.get(i.variantId)!.productId, variantId: i.variantId, supplierSku: i.supplierSku || null,
      quantity: i.quantity, unitCostCents: i.unitCostCents, discountCents: i.discountCents ?? 0, lineTotalCents: lineTotal(i),
    })));
    await audit(tx, actor, "Created purchase order", "purchase_order", po!.poNumber, undefined, { supplier: supplier.name, totalCents, items: input.items.length });
    return po!;
  });
}

/** Only while DRAFT — once submitted for approval, the numbers on record shouldn't move under anyone. */
export async function updatePurchaseOrder(db: Db, actor: Actor, id: string, input: NewPurchaseOrder): Promise<PurchaseOrderRow> {
  assertCan(actor, "purchasing:write");
  validateItems(input.items);
  const discountCents = input.discountCents ?? 0, shippingCents = input.shippingCents ?? 0, taxCents = input.taxCents ?? 0;
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
    if (!before) throw new NotFoundError("Purchase order not found.");
    if (before.status !== "DRAFT") throw new ValidationError("Only a draft purchase order can be edited.");
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw new ValidationError("Choose a supplier.");
    const variantIds = [...new Set(input.items.map((i) => i.variantId))];
    const variantRows = await tx.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.id, variantIds));
    const byId = new Map(variantRows.map((v) => [v.id, v]));
    for (const i of input.items) if (!byId.has(i.variantId)) throw new ValidationError("One of the selected variants no longer exists.");
    const { subtotalCents, totalCents } = computeTotals(input.items, discountCents, shippingCents, taxCents);
    const [po] = await tx.update(purchaseOrders).set({
      supplierId: input.supplierId, expectedDeliveryDate: input.expectedDeliveryDate ?? null, currency: input.currency ?? supplier.currency,
      paymentTerms: input.paymentTerms ?? null, notes: input.notes ?? "", subtotalCents, discountCents, shippingCents, taxCents, totalCents, dueDate: input.dueDate ?? null,
    }).where(eq(purchaseOrders.id, id)).returning();
    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
    await tx.insert(purchaseOrderItems).values(input.items.map((i) => ({
      purchaseOrderId: id, productId: byId.get(i.variantId)!.productId, variantId: i.variantId, supplierSku: i.supplierSku || null,
      quantity: i.quantity, unitCostCents: i.unitCostCents, discountCents: i.discountCents ?? 0, lineTotalCents: lineTotal(i),
    })));
    await audit(tx, actor, "Updated purchase order", "purchase_order", po!.poNumber, { totalCents: before.totalCents }, { totalCents });
    return po!;
  });
}

/** DRAFT → PENDING_APPROVAL → APPROVED → ORDERED, plus → CANCELLED from most states (brief §16). Receiving
 *  (→ PARTIALLY_RECEIVED / RECEIVED) is driven by lib/purchasing/receiving.ts, never by this function. */
export const PO_TRANSITIONS: Record<PurchaseOrderRow["status"], PurchaseOrderRow["status"][]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["ORDERED", "CANCELLED"],
  ORDERED: ["CANCELLED"],
  PARTIALLY_RECEIVED: ["CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};
export async function setPurchaseOrderStatus(db: Db, actor: Actor, id: string, next: PurchaseOrderRow["status"]): Promise<PurchaseOrderRow> {
  assertCan(actor, "purchasing:write");
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
    if (!po) throw new NotFoundError("Purchase order not found.");
    if (!PO_TRANSITIONS[po.status].includes(next)) throw new ValidationError(`A purchase order that is ${po.status} cannot become ${next}.`);
    const set: Partial<typeof purchaseOrders.$inferInsert> = { status: next };
    if (next === "APPROVED") { set.approvedByUserId = actor.userId; set.approvedAt = new Date(); }
    if (next === "ORDERED") set.orderedAt = new Date();
    if (next === "CANCELLED") set.cancelledAt = new Date();
    const [row] = await tx.update(purchaseOrders).set(set).where(eq(purchaseOrders.id, id)).returning();
    const action = next === "APPROVED" ? "Approved purchase order" : next === "CANCELLED" ? "Cancelled purchase order" : "Changed purchase order status";
    await audit(tx, actor, action, "purchase_order", po.poNumber, { status: po.status }, { status: next });
    return row!;
  });
}

export async function getPurchaseOrder(db: DbOrTx, id: string) {
  const [po] = await db.select({ po: purchaseOrders, supplierName: suppliers.name, supplierEmail: suppliers.email, supplierAddress: sql<string | null>`concat_ws(', ', ${suppliers.addressLine1}, ${suppliers.addressLine2}, ${suppliers.city}, ${suppliers.postalCode}, ${suppliers.country})` })
    .from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.id, id));
  if (!po) return null;
  const items = await db.select({
    id: purchaseOrderItems.id, variantId: purchaseOrderItems.variantId, sku: productVariants.sku, productName: products.name,
    supplierSku: purchaseOrderItems.supplierSku, quantity: purchaseOrderItems.quantity, unitCostCents: purchaseOrderItems.unitCostCents,
    discountCents: purchaseOrderItems.discountCents, lineTotalCents: purchaseOrderItems.lineTotalCents, receivedQuantity: purchaseOrderItems.receivedQuantity,
  }).from(purchaseOrderItems).innerJoin(productVariants, eq(productVariants.id, purchaseOrderItems.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id)).orderBy(productVariants.sku);
  const documents = await db.select().from(purchaseDocuments).where(eq(purchaseDocuments.purchaseOrderId, id)).orderBy(desc(purchaseDocuments.createdAt));
  const sends = await db.select().from(purchaseOrderSends).where(eq(purchaseOrderSends.purchaseOrderId, id)).orderBy(desc(purchaseOrderSends.createdAt));
  const payments = await db.select().from(purchasePayments).where(eq(purchasePayments.purchaseOrderId, id)).orderBy(desc(purchasePayments.paidAt));
  return { ...po, items, documents, sends, payments };
}

export async function listPurchaseOrders(db: DbOrTx, opts: { status?: string; supplierId?: string; page: number; pageSize: number }) {
  const conds = [];
  if (opts.status) conds.push(sql`o.status = ${opts.status}`);
  if (opts.supplierId) conds.push(sql`o.supplier_id = ${opts.supplierId}`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const res = await rows<Record<string, string | null>>(db, sql`
    select o.id, o.po_number, o.status, o.payment_status, o.order_date, o.expected_delivery_date, o.total_cents, s.name as supplier_name,
      (select coalesce(sum(quantity),0) from purchase_order_items where purchase_order_id = o.id) as ordered_qty,
      (select coalesce(sum(received_quantity),0) from purchase_order_items where purchase_order_id = o.id) as received_qty,
      count(*) over () as total
    from purchase_orders o join suppliers s on s.id = o.supplier_id
    ${where} order by o.order_date desc limit ${opts.pageSize} offset ${(opts.page - 1) * opts.pageSize}`);
  return {
    total: n(res[0]?.total), page: opts.page, pageSize: opts.pageSize,
    rows: res.map((r) => ({
      id: r.id!, poNumber: r.po_number!, status: r.status!, paymentStatus: r.payment_status!, orderDate: new Date(r.order_date!),
      expectedDeliveryDate: r.expected_delivery_date ? new Date(r.expected_delivery_date) : null, totalCents: n(r.total_cents), supplierName: r.supplier_name!,
      orderedQty: n(r.ordered_qty), receivedQty: n(r.received_qty),
    })),
  };
}

/* --------------------------------------------------------------------- documents (brief §42) */
export async function addPurchaseDocument(db: Db, actor: Actor, purchaseOrderId: string, doc: { filename: string; url: string; type: "quotation" | "invoice" | "packing_list" | "receiving_document" | "other" }) {
  assertCan(actor, "purchasing:write");
  if (!/^https:\/\/[^\s"'<>]+$/.test(doc.url.trim())) throw new ValidationError("Document URL must start with https://.");
  const [row] = await db.insert(purchaseDocuments).values({ purchaseOrderId, filename: doc.filename.trim(), url: doc.url.trim(), type: doc.type, uploadedByUserId: actor.userId }).returning();
  await audit(db, actor, "Added purchase order document", "purchase_order", purchaseOrderId, undefined, { filename: doc.filename, type: doc.type });
  return row!;
}
export async function removePurchaseDocument(db: Db, actor: Actor, id: string) {
  assertCan(actor, "purchasing:write");
  const [row] = await db.delete(purchaseDocuments).where(eq(purchaseDocuments.id, id)).returning();
  if (row) await audit(db, actor, "Removed purchase order document", "purchase_order", row.purchaseOrderId, { filename: row.filename }, undefined);
}

/* --------------------------------------------------------------------- email (brief §18) */
export async function sendPurchaseOrderEmail(db: Db, actor: Actor, purchaseOrderId: string, recipientEmail: string) {
  assertCan(actor, "purchasing:write");
  const [row] = await db.select({ po: purchaseOrders, supplierName: suppliers.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.id, purchaseOrderId));
  if (!row) throw new NotFoundError("Purchase order not found.");
  const email = recipientEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  let succeeded = true, errorMessage: string | null = null;
  try {
    await emailProvider.send(purchaseOrderEmail({ email, poNumber: row.po.poNumber, supplierName: row.supplierName, totalText: formatMoney(row.po.totalCents), expectedDelivery: row.po.expectedDeliveryDate?.toISOString().slice(0, 10) }));
  } catch (e) { succeeded = false; errorMessage = e instanceof Error ? e.message : "Send failed."; }
  await db.insert(purchaseOrderSends).values({ purchaseOrderId, sentByUserId: actor.userId, recipientEmail: email, succeeded, errorMessage });
  await audit(db, actor, "Sent purchase order email", "purchase_order", row.po.poNumber, undefined, { recipient: email, succeeded });
  if (!succeeded) throw new ValidationError(errorMessage ?? "Could not send the email.");
}

/* --------------------------------------------------------------------- payments (brief §41) */
function nextPaymentStatus(totalCents: number, amountPaidCents: number): PurchaseOrderRow["paymentStatus"] {
  if (amountPaidCents <= 0) return "UNPAID";
  return amountPaidCents >= totalCents ? "PAID" : "PARTIALLY_PAID";
}
export async function recordPurchasePayment(db: Db, actor: Actor, purchaseOrderId: string, input: { amountCents: number; paidAt?: Date; note?: string }) {
  assertCan(actor, "purchasing:write");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ValidationError("Enter an amount above zero.");
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId)).for("update");
    if (!po) throw new NotFoundError("Purchase order not found.");
    const amountPaidCents = po.amountPaidCents + input.amountCents;
    const paymentStatus = nextPaymentStatus(po.totalCents, amountPaidCents);
    await tx.update(purchaseOrders).set({ amountPaidCents, paymentStatus }).where(eq(purchaseOrders.id, purchaseOrderId));
    const [row] = await tx.insert(purchasePayments).values({ purchaseOrderId, amountCents: input.amountCents, paidAt: input.paidAt ?? new Date(), note: input.note ?? null, recordedByUserId: actor.userId }).returning();
    await audit(tx, actor, "Recorded purchase order payment", "purchase_order", po.poNumber, { amountPaidCents: po.amountPaidCents }, { amountPaidCents, paymentStatus });
    return row!;
  });
}

/** OVERDUE is derived, never stored (docs/PURCHASING.md). */
export function isOverdue(po: Pick<PurchaseOrderRow, "dueDate" | "paymentStatus">, now = new Date()): boolean {
  return !!po.dueDate && po.paymentStatus !== "PAID" && po.dueDate.getTime() < now.getTime();
}
