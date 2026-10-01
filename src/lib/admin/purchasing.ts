/**
 * Read models for the purchasing admin (brief §30-35). Reorder suggestions here use a *different*, simpler
 * formula than the pre-existing sales-velocity one in `lib/admin/inventory.ts` (brief §31's own worked
 * example: `Target Stock − Available − Incoming`) — the two coexist for two different purposes; see
 * docs/REORDERING.md for exactly why neither replaces the other.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { n, rows } from "./sql";
import { inventory } from "../db/schema";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { ValidationError, NotFoundError } from "../errors";

/** A PO counts toward "incoming" once it's committed (APPROVED/ORDERED/PARTIALLY_RECEIVED) — a DRAFT or
 *  PENDING_APPROVAL order isn't a real commitment yet, and RECEIVED/CANCELLED are no longer pending. */
const INCOMING_STATUSES = sql`('APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED')`;

export type ReorderSuggestionRow = {
  variantId: string; productId: string; productName: string; label: string; sku: string; image: string | null;
  stockQuantity: number; reservedQuantity: number; availableStock: number; reorderLevel: number; targetStockLevel: number | null;
  incomingQuantity: number; preferredSupplierId: string | null; preferredSupplierName: string | null; lastCostCents: number | null; leadTimeDays: number | null;
  suggestedQuantity: number;
};

export async function getReorderSuggestions(db: DbOrTx): Promise<ReorderSuggestionRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    with incoming as (
      select i.variant_id, sum(i.quantity - i.received_quantity) as qty
      from purchase_order_items i join purchase_orders o on o.id = i.purchase_order_id
      where o.status in ${INCOMING_STATUSES} group by i.variant_id
    ), preferred as (
      select distinct on (sp.variant_id) sp.variant_id, sp.supplier_id, s.name as supplier_name, sp.purchase_price_cents, sp.lead_time_days
      from supplier_products sp join suppliers s on s.id = sp.supplier_id
      order by sp.variant_id, sp.preferred_supplier desc, sp.purchase_price_cents asc
    )
    select vs.variant_id, vs.product_id, vs.product_name, vs.variant_label as label, vs.sku,
      (select url from product_images pi where pi.product_id = vs.product_id order by position limit 1) as image,
      vs.stock_quantity, vs.reserved_quantity, vs.available_stock, vs.reorder_level, i2.target_stock_level,
      coalesce(inc.qty, 0) as incoming_quantity, p.supplier_id, p.supplier_name, p.purchase_price_cents, p.lead_time_days
    from variant_stock vs
    join inventory i2 on i2.variant_id = vs.variant_id
    left join incoming inc on inc.variant_id = vs.variant_id
    left join preferred p on p.variant_id = vs.variant_id
    where vs.product_status <> 'archived' and vs.available_stock <= vs.reorder_level
    order by vs.available_stock asc`);
  return res.map((x) => {
    const available = n(x.available_stock), incoming = n(x.incoming_quantity), reorderLevel = n(x.reorder_level);
    const target = x.target_stock_level != null ? n(x.target_stock_level) : reorderLevel * 5;
    return {
      variantId: x.variant_id!, productId: x.product_id!, productName: x.product_name!, label: x.label!, sku: x.sku!, image: x.image ?? null,
      stockQuantity: n(x.stock_quantity), reservedQuantity: n(x.reserved_quantity), availableStock: available, reorderLevel, targetStockLevel: x.target_stock_level != null ? n(x.target_stock_level) : null,
      incomingQuantity: incoming, preferredSupplierId: x.supplier_id ?? null, preferredSupplierName: x.supplier_name ?? null,
      lastCostCents: x.purchase_price_cents != null ? n(x.purchase_price_cents) : null, leadTimeDays: x.lead_time_days != null ? n(x.lead_time_days) : null,
      suggestedQuantity: Math.max(0, target - available - incoming),
    };
  });
}

export type IncomingInventoryRow = {
  poId: string; poNumber: string; status: string; supplierName: string; productName: string; sku: string;
  quantity: number; receivedQuantity: number; remaining: number; expectedDeliveryDate: Date | null;
};
export async function getIncomingInventory(db: DbOrTx): Promise<IncomingInventoryRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    select o.id as po_id, o.po_number, o.status, s.name as supplier_name, pr.name as product_name, v.sku,
      i.quantity, i.received_quantity, o.expected_delivery_date
    from purchase_order_items i
    join purchase_orders o on o.id = i.purchase_order_id
    join suppliers s on s.id = o.supplier_id
    join product_variants v on v.id = i.variant_id
    join products pr on pr.id = v.product_id
    where o.status in ${INCOMING_STATUSES} and i.received_quantity < i.quantity
    order by o.expected_delivery_date nulls last, o.order_date`);
  return res.map((x) => ({
    poId: x.po_id!, poNumber: x.po_number!, status: x.status!, supplierName: x.supplier_name!, productName: x.product_name!, sku: x.sku!,
    quantity: n(x.quantity), receivedQuantity: n(x.received_quantity), remaining: n(x.quantity) - n(x.received_quantity),
    expectedDeliveryDate: x.expected_delivery_date ? new Date(x.expected_delivery_date) : null,
  }));
}

/** Incoming inventory value — for the dashboard split (brief §29): what's on order but not yet sellable,
 *  valued at the PO's own unit cost (never the variant's current cost, since that's a different number). */
export async function getIncomingInventoryValueCents(db: DbOrTx): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum((i.quantity - i.received_quantity) * i.unit_cost_cents), 0) as v
    from purchase_order_items i join purchase_orders o on o.id = i.purchase_order_id
    where o.status in ${INCOMING_STATUSES} and i.received_quantity < i.quantity`);
  return n(row?.v);
}

export async function setTargetStockLevel(db: Db, actor: Actor, variantId: string, level: number | null) {
  assertCan(actor, "inventory:write");
  if (level != null && (!Number.isInteger(level) || level < 0)) throw new ValidationError("Target stock level must be zero or more.");
  const [row] = await db.update(inventory).set({ targetStockLevel: level }).where(eq(inventory.variantId, variantId)).returning({ variantId: inventory.variantId });
  if (!row) throw new NotFoundError("Variant not found.");
  await audit(db, actor, "Changed target stock level", "product_variant", variantId, undefined, { targetStockLevel: level });
}

/* --------------------------------------------------------------------- cost & price history (brief §37-38) */
export type CostHistoryRow = { date: Date; supplierName: string | null; unitCostCents: number; quantity: number; referenceId: string | null; };
/** Reads the *existing* inventory_movements ledger — never a second, parallel cost log (docs/PHASE_8_AUDIT.md). */
export async function getCostHistory(db: DbOrTx, variantId: string): Promise<CostHistoryRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    select m.created_at, s.name as supplier_name, m.unit_cost_cents, m.quantity, m.reference_id
    from inventory_movements m left join suppliers s on s.id = m.supplier_id
    where m.variant_id = ${variantId} and m.movement_type in ('RESTOCK', 'PURCHASE') and m.unit_cost_cents is not null and m.reference_type <> 'opening_balance'
    order by m.created_at desc limit 200`);
  return res.map((x) => ({ date: new Date(x.created_at!), supplierName: x.supplier_name ?? null, unitCostCents: n(x.unit_cost_cents), quantity: n(x.quantity), referenceId: x.reference_id ?? null }));
}

export type PriceHistoryRow = { effectiveAt: Date; sellingPriceCents: number; compareAtPriceCents: number | null; changedBy: string | null };
export async function getPriceHistory(db: DbOrTx, variantId: string): Promise<PriceHistoryRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    select h.effective_at, h.selling_price_cents, h.compare_at_price_cents, u.name as changed_by
    from product_price_history h left join users u on u.id = h.changed_by_user_id
    where h.variant_id = ${variantId} order by h.effective_at desc limit 200`);
  return res.map((x) => ({ effectiveAt: new Date(x.effective_at!), sellingPriceCents: n(x.selling_price_cents), compareAtPriceCents: x.compare_at_price_cents != null ? n(x.compare_at_price_cents) : null, changedBy: x.changed_by ?? null }));
}
