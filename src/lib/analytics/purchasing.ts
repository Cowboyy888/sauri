/**
 * Supplier and purchase analytics (brief §34-36). Every figure comes from real `purchase_orders`/
 * `purchase_receipts`/`purchase_receipt_items` rows — "only calculate metrics supported by actual receiving
 * data" (brief §34). Purchase spend is never presented as COGS (brief §36) — COGS still comes exclusively
 * from `orders.cost_total_cents` (docs/ANALYTICS.md), completely unchanged by this phase.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import type { Range } from "./service";
import { getMetrics } from "./service";
import { n, rows } from "../admin/sql";
import { getIncomingInventoryValueCents } from "../admin/purchasing";

const inRange = (col: string, r: Range) => sql.raw(`${col} >= '${r.from.toISOString()}' and ${col} < '${r.to.toISOString()}'`);
const round2 = (v: number) => Math.round(v * 100) / 100;

export type SupplierPerformanceRow = {
  supplierId: string; supplierName: string; purchaseOrders: number; unitsPurchased: number; totalSpendCents: number;
  averageCostCents: number | null; averageLeadTimeDays: number | null; lateDeliveries: number; rejectedQuantity: number; damagedQuantity: number;
};
export async function getSupplierPerformance(db: DbOrTx, r: Range): Promise<SupplierPerformanceRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    with po as (
      select o.id, o.supplier_id, o.order_date, o.expected_delivery_date,
        (select min(received_at) from purchase_receipts pr where pr.purchase_order_id = o.id) as first_received_at
      from purchase_orders o where ${inRange("o.order_date", r)} and o.status <> 'CANCELLED'
    ), receipt_items as (
      select i.purchase_order_id, ri.accepted_quantity, ri.damaged_quantity, ri.rejected_quantity, ri.unit_cost_cents,
        (ri.accepted_quantity + ri.damaged_quantity + ri.rejected_quantity) as total_qty
      from purchase_receipt_items ri
      join purchase_order_items i on i.id = ri.purchase_order_item_id
      join purchase_receipts pr on pr.id = ri.purchase_receipt_id
      where pr.purchase_order_id in (select id from po)
    )
    select s.id, s.name,
      count(distinct po.id) as po_count,
      coalesce(sum(ri.total_qty), 0) as units,
      coalesce(sum(ri.total_qty * ri.unit_cost_cents), 0) as spend,
      (case when sum(ri.accepted_quantity) > 0 then sum(ri.accepted_quantity * ri.unit_cost_cents)::numeric / nullif(sum(ri.accepted_quantity),0) else null end) as avg_cost,
      avg(extract(epoch from (po.first_received_at - po.order_date)) / 86400.0) filter (where po.first_received_at is not null) as avg_lead_time,
      count(*) filter (where po.expected_delivery_date is not null and po.first_received_at is not null and po.first_received_at > po.expected_delivery_date) as late,
      coalesce(sum(ri.rejected_quantity), 0) as rejected,
      coalesce(sum(ri.damaged_quantity), 0) as damaged
    from suppliers s
    join po on po.supplier_id = s.id
    left join receipt_items ri on ri.purchase_order_id = po.id
    group by s.id, s.name order by spend desc`);
  return res.map((x) => ({
    supplierId: x.id!, supplierName: x.name!, purchaseOrders: n(x.po_count), unitsPurchased: n(x.units), totalSpendCents: n(x.spend),
    averageCostCents: x.avg_cost != null ? Math.round(Number(x.avg_cost)) : null,
    averageLeadTimeDays: x.avg_lead_time != null ? round2(Number(x.avg_lead_time)) : null,
    lateDeliveries: n(x.late), rejectedQuantity: n(x.rejected), damagedQuantity: n(x.damaged),
  }));
}

export type PurchaseAnalytics = {
  purchaseOrders: number; purchaseSpendCents: number; unitsPurchased: number; averageCostCents: number | null;
  openPurchaseOrders: number; incomingInventoryValueCents: number; supplierSpend: { supplierName: string; spendCents: number }[];
};
export async function getPurchaseAnalytics(db: DbOrTx, r: Range): Promise<PurchaseAnalytics> {
  const [row] = await rows<Record<string, string | null>>(db, sql`
    with po as (select * from purchase_orders where ${inRange("order_date", r)} and status <> 'CANCELLED')
    select count(*) as po_count, coalesce(sum(total_cents), 0) as spend,
      (select coalesce(sum(i.quantity),0) from purchase_order_items i where i.purchase_order_id in (select id from po)) as units
    from po`);
  const [openRow] = await rows<{ n: string }>(db, sql`select count(*) as n from purchase_orders where status in ('DRAFT','PENDING_APPROVAL','APPROVED','ORDERED','PARTIALLY_RECEIVED')`);
  const supplierSpend = await rows<{ supplier_name: string; spend: string }>(db, sql`
    select s.name as supplier_name, coalesce(sum(o.total_cents),0) as spend from purchase_orders o join suppliers s on s.id = o.supplier_id
    where ${inRange("o.order_date", r)} and o.status <> 'CANCELLED' group by s.name order by spend desc limit 10`);
  const units = n(row?.units), spend = n(row?.spend);
  const incomingInventoryValueCents = await getIncomingInventoryValueCents(db);
  return {
    purchaseOrders: n(row?.po_count), purchaseSpendCents: spend, unitsPurchased: units, averageCostCents: units ? Math.round(spend / units) : null,
    openPurchaseOrders: n(openRow?.n), incomingInventoryValueCents,
    supplierSpend: supplierSpend.map((s) => ({ supplierName: s.supplier_name, spendCents: n(s.spend) })),
  };
}

/** Purchase spend vs. sales revenue vs. inventory value — three clearly distinct numbers (brief §36), never
 *  conflated with each other. Purchase spend is what was paid to suppliers in the period; COGS (from
 *  `getMetrics`) is the cost of goods actually *sold* in the period — the two answer different questions and
 *  are shown side by side, never substituted for one another. */
export type PurchaseVsSales = { salesRevenueCents: number; purchaseSpendCents: number; cogsCents: number; inventoryValueCents: number; unitsSold: number; unitsPurchased: number };
export async function getPurchaseVsSales(db: DbOrTx, r: Range): Promise<PurchaseVsSales> {
  const [sales, purchases, inv] = await Promise.all([
    getMetrics(db, r),
    getPurchaseAnalytics(db, r),
    rows<{ v: string }>(db, sql`select coalesce(sum(inventory_value_cents),0) as v from variant_stock where product_status <> 'archived'`),
  ]);
  return {
    salesRevenueCents: sales.netRevenueCents, purchaseSpendCents: purchases.purchaseSpendCents, cogsCents: sales.cogsCents,
    inventoryValueCents: n(inv[0]?.v), unitsSold: sales.units, unitsPurchased: purchases.unitsPurchased,
  };
}
