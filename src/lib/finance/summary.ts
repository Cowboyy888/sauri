/**
 * The one authoritative financial calculation service (brief §14). Every finance page and report calls
 * through these functions — none recomputes a formula inline. Dollar figures are read straight from the
 * existing sales engine (`getMetrics`) wherever possible; this module only adds what didn't already exist:
 * operating expenses/profit, cash in/out, and outstanding/overdue supplier payments.
 *
 * N/A handling (brief §4, §32): a percentage is `null`, never a misleading 0%, when its denominator is
 * zero. `getMetrics()` itself still returns 0-on-zero for its own (Phase 1) margin field, unchanged, so
 * pre-existing dashboards keep their established display — this module recomputes the null-safe version
 * from the same underlying cents figures rather than patching Phase 1. See docs/FINANCIAL_CALCULATIONS.md.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { getMetrics, type Range } from "../analytics/service";
import { n, rows } from "../admin/sql";
import { getOperatingExpensesCents, getExpensesCashOutCents } from "./expenses";

const marginOrNull = (numerator: number, denominator: number): number | null => (denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 100);

export async function getGrossSales(db: DbOrTx, r: Range) { return (await getMetrics(db, r)).grossSalesCents; }
export async function getDiscounts(db: DbOrTx, r: Range) { return (await getMetrics(db, r)).discountCents; }
export async function getRefunds(db: DbOrTx, r: Range) { return (await getMetrics(db, r)).refundCents; }
export async function getNetRevenue(db: DbOrTx, r: Range) { return (await getMetrics(db, r)).netRevenueCents; }
export async function getCOGS(db: DbOrTx, r: Range) { return (await getMetrics(db, r)).cogsCents; }
export async function getGrossProfit(db: DbOrTx, r: Range) { return (await getMetrics(db, r)).grossProfitCents; }
export async function getGrossMargin(db: DbOrTx, r: Range) { const m = await getMetrics(db, r); return marginOrNull(m.grossProfitCents, m.netRevenueCents); }

export const getOperatingExpenses = getOperatingExpensesCents;
export async function getOperatingProfit(db: DbOrTx, r: Range) {
  const [gp, opex] = await Promise.all([getGrossProfit(db, r), getOperatingExpenses(db, r)]);
  return gp - opex;
}
export async function getOperatingMargin(db: DbOrTx, r: Range) {
  const [m, opex] = await Promise.all([getMetrics(db, r), getOperatingExpenses(db, r)]);
  return marginOrNull(m.grossProfitCents - opex, m.netRevenueCents);
}

/** Cash actually received from customers (brief §10) — dated by `orders.paid_at`, the moment payment was
 *  actually confirmed, not `payments.created_at` (which for a web order is when checkout *started*). */
export async function getCustomerPayments(db: DbOrTx, r: Range): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(p.amount_cents), 0) as v from payments p join orders o on o.id = p.order_id
    where p.status = 'succeeded' and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}`);
  return n(row?.v);
}
export async function getSupplierPayments(db: DbOrTx, r: Range): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(amount_cents), 0) as v from purchase_payments where paid_at >= ${r.from.toISOString()} and paid_at < ${r.to.toISOString()}`);
  return n(row?.v);
}
/** Cash paid back to customers (brief §11-12) — a distinct outflow line, never netted against cash in. */
export async function getRefundsCashOut(db: DbOrTx, r: Range): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(amount_cents), 0) as v from refunds where created_at >= ${r.from.toISOString()} and created_at < ${r.to.toISOString()}`);
  return n(row?.v);
}
export async function getCashIn(db: DbOrTx, r: Range): Promise<number> { return getCustomerPayments(db, r); }
export async function getCashOut(db: DbOrTx, r: Range): Promise<number> {
  const [supplier, expenses, refunds] = await Promise.all([getSupplierPayments(db, r), getExpensesCashOutCents(db, r), getRefundsCashOut(db, r)]);
  return supplier + expenses + refunds;
}
export async function getNetCashFlow(db: DbOrTx, r: Range): Promise<number> {
  const [cashIn, cashOut] = await Promise.all([getCashIn(db, r), getCashOut(db, r)]);
  return cashIn - cashOut;
}

/** Snapshots, not date-bound — "outstanding" is inherently a point-in-time position, same convention as
 *  `getInventoryValue()`. A CANCELLED purchase order never counts (nothing is actually owed on it). */
export async function getOutstandingSupplierPayments(db: DbOrTx): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(total_cents - amount_paid_cents), 0) as v from purchase_orders where status <> 'CANCELLED' and payment_status <> 'PAID'`);
  return n(row?.v);
}
export async function getOverdueSupplierPayments(db: DbOrTx): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(total_cents - amount_paid_cents), 0) as v from purchase_orders
    where status <> 'CANCELLED' and payment_status <> 'PAID' and due_date is not null and due_date < now()`);
  return n(row?.v);
}
export async function getTotalPurchases(db: DbOrTx, r: Range): Promise<number> {
  const [row] = await rows<{ v: string | null }>(db, sql`
    select coalesce(sum(total_cents), 0) as v from purchase_orders where status <> 'CANCELLED' and order_date >= ${r.from.toISOString()} and order_date < ${r.to.toISOString()}`);
  return n(row?.v);
}

export type FinancialSummary = {
  grossSalesCents: number; discountCents: number; refundCents: number; netRevenueCents: number;
  cogsCents: number; grossProfitCents: number; grossMarginPct: number | null;
  operatingExpensesCents: number; operatingProfitCents: number; operatingMarginPct: number | null;
  cashInCents: number; cashOutCents: number; netCashFlowCents: number;
  totalPurchasesCents: number; outstandingSupplierPaymentsCents: number; overdueSupplierPaymentsCents: number;
};
/** Every figure the Financial Overview page needs, in as few round trips as the underlying data allows —
 *  the same "one call per page" discipline `getMetrics()` established in Phase 1. */
export async function getFinancialSummary(db: DbOrTx, r: Range): Promise<FinancialSummary> {
  const [m, opex, cashIn, supplierPaid, expensesPaid, refundsPaid, totalPurchases, outstanding, overdue] = await Promise.all([
    getMetrics(db, r), getOperatingExpensesCents(db, r), getCustomerPayments(db, r), getSupplierPayments(db, r),
    getExpensesCashOutCents(db, r), getRefundsCashOut(db, r), getTotalPurchases(db, r), getOutstandingSupplierPayments(db), getOverdueSupplierPayments(db),
  ]);
  const cashOutCents = supplierPaid + expensesPaid + refundsPaid;
  const operatingProfitCents = m.grossProfitCents - opex;
  return {
    grossSalesCents: m.grossSalesCents, discountCents: m.discountCents, refundCents: m.refundCents, netRevenueCents: m.netRevenueCents,
    cogsCents: m.cogsCents, grossProfitCents: m.grossProfitCents, grossMarginPct: marginOrNull(m.grossProfitCents, m.netRevenueCents),
    operatingExpensesCents: opex, operatingProfitCents, operatingMarginPct: marginOrNull(operatingProfitCents, m.netRevenueCents),
    cashInCents: cashIn, cashOutCents, netCashFlowCents: cashIn - cashOutCents,
    totalPurchasesCents: totalPurchases, outstandingSupplierPaymentsCents: outstanding, overdueSupplierPaymentsCents: overdue,
  };
}
