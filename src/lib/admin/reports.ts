/**
 * Reports (brief §41). One definition per report produces typed rows; the same rows feed the on-screen preview
 * and the CSV / Excel / PDF exports, so an export can never disagree with the screen.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { STORE } from "../config";
import { getMetrics, getSalesBy, getSalesByChannel, getSeries, type Range } from "../analytics/service";
import { listOrders } from "./orders";
import { lowStock, outOfStock } from "./inventory";
import { n, rows } from "./sql";
import { getFinancialSummary } from "../finance/summary";
import { getExpensesByCategory, listExpenses } from "../finance/expenses";
import { listCustomerPayments } from "../finance/customer-payments";
import { listSupplierPayments } from "../finance/supplier-payments";
import { listRefunds, getRefundAnalytics } from "../finance/refunds";
import { getTaxReport } from "../finance/tax";
import { getProductProfitability } from "../finance/product-profitability";

export type ColType = "text" | "int" | "money" | "pct" | "date" | "datetime";
export type Column = { key: string; label: string; type: ColType };
export type Cell = string | number | null | undefined;
export type Report = { key: ReportKey; title: string; description: string; dateBound: boolean; columns: Column[]; rows: Record<string, Cell>[]; totals?: Record<string, number> };
export const REPORT_KEYS = [
  "daily-sales", "weekly-sales", "monthly-sales", "orders", "inventory", "product-performance", "profit", "customers", "low-stock",
  // Phase 9 (brief §18) — extends this same engine, never a second one (docs/FINANCE_AUDIT.md).
  "management-pl", "expenses", "cash-flow", "customer-payments", "supplier-payments", "refunds", "tax-summary", "purchases", "product-profitability", "sales-channel",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_META: Record<ReportKey, { title: string; description: string; dateBound: boolean }> = {
  "daily-sales": { title: "Daily sales", description: "Orders, units, net revenue, COGS and gross profit for each day.", dateBound: true },
  "weekly-sales": { title: "Weekly sales", description: "The same figures grouped by week (weeks start Monday).", dateBound: true },
  "monthly-sales": { title: "Monthly sales", description: "The same figures grouped by calendar month.", dateBound: true },
  orders: { title: "Orders", description: "Every order placed in the period, with totals, status and profit.", dateBound: true },
  inventory: { title: "Inventory", description: "Every variant: stock, reserved, available, cost, price and value. A snapshot as of now.", dateBound: false },
  "product-performance": { title: "Product performance", description: "Units, revenue, COGS, gross profit and margin by product.", dateBound: true },
  profit: { title: "Profit", description: "Profit and loss summary for the period.", dateBound: true },
  customers: { title: "Customers", description: "Customers who bought in the period, with lifetime figures.", dateBound: true },
  "low-stock": { title: "Low stock", description: "Low and out-of-stock variants, most urgent first, with reorder estimates.", dateBound: false },
  "management-pl": { title: "Management P&L", description: "Revenue, COGS, gross profit, operating expenses and operating profit for the period — an operational statement, not a certified accounting P&L.", dateBound: true },
  expenses: { title: "Expenses", description: "Every posted (approved or paid) operating expense in the period.", dateBound: true },
  "cash-flow": { title: "Cash flow", description: "Actual cash in and out — customer payments, supplier payments, expenses paid, and refunds paid back.", dateBound: true },
  "customer-payments": { title: "Customer payments", description: "Every customer payment recorded in the period, with its provider, status and any refunded amount.", dateBound: true },
  "supplier-payments": { title: "Supplier payments", description: "Every purchase order's payment position: total, paid, remaining, due date and status.", dateBound: false },
  refunds: { title: "Refunds", description: "Every refund processed in the period, with reason and whether the goods were restocked.", dateBound: true },
  "tax-summary": { title: "Tax summary", description: "Taxable sales and tax collected for the period, at the currently configured rate.", dateBound: true },
  purchases: { title: "Purchases", description: "Every purchase order placed in the period, with totals and payment position.", dateBound: true },
  "product-profitability": { title: "Product profitability", description: "Units sold, revenue, COGS, gross profit and margin by product, with current stock and inventory value.", dateBound: true },
  "sales-channel": { title: "Sales by channel", description: "Net revenue, orders, units, gross profit and margin by sales channel.", dateBound: true },
};

const cents = (c: number) => Math.round(c) / 100; // exported money is in dollars (number)
const SALES_COLS: Column[] = [
  { key: "period", label: "Period", type: "text" }, { key: "orders", label: "Orders", type: "int" }, { key: "units", label: "Units sold", type: "int" },
  { key: "revenue", label: "Net revenue", type: "money" }, { key: "cogs", label: "COGS", type: "money" }, { key: "gross_profit", label: "Gross profit", type: "money" }, { key: "margin", label: "Gross margin %", type: "pct" },
];

export async function buildReport(db: DbOrTx, key: ReportKey, r: Range): Promise<Report> {
  const meta = { key, ...REPORT_META[key] };
  switch (key) {
    case "daily-sales": case "weekly-sales": case "monthly-sales": {
      const unit = key === "daily-sales" ? "day" : key === "weekly-sales" ? "week" : "month";
      const s = await getSeries(db, r, { unit });
      const rowsOut = s.points.map((p) => ({ period: unit === "month" ? p.bucket.slice(0, 7) : p.bucket.slice(0, 10), orders: p.orders, units: p.units, revenue: cents(p.netRevenueCents), cogs: cents(p.cogsCents), gross_profit: cents(p.grossProfitCents), margin: p.netRevenueCents ? Math.round((p.grossProfitCents / p.netRevenueCents) * 1000) / 10 : 0 }));
      const t = rowsOut.reduce((a, x) => ({ orders: a.orders + x.orders, units: a.units + x.units, revenue: a.revenue + x.revenue, cogs: a.cogs + x.cogs, gross_profit: a.gross_profit + x.gross_profit }), { orders: 0, units: 0, revenue: 0, cogs: 0, gross_profit: 0 });
      return { ...meta, columns: SALES_COLS, rows: rowsOut, totals: { ...t, margin: t.revenue ? Math.round((t.gross_profit / t.revenue) * 1000) / 10 : 0 } };
    }
    case "orders": {
      const all = await listOrders(db, { range: r, page: 1, pageSize: 100_000, sort: "date", dir: "asc" });
      return { ...meta, columns: [
        { key: "order", label: "Order", type: "text" }, { key: "date", label: "Date", type: "datetime" }, { key: "customer", label: "Customer", type: "text" }, { key: "email", label: "Email", type: "text" },
        { key: "channel", label: "Channel", type: "text" }, { key: "items", label: "Items", type: "int" }, { key: "payment", label: "Payment", type: "text" }, { key: "status", label: "Status", type: "text" },
        { key: "total", label: "Total", type: "money" }, { key: "gross_profit", label: "Gross profit", type: "money" }, { key: "margin", label: "Margin %", type: "pct" }],
        rows: all.rows.map((o) => ({ order: o.orderNumber, date: o.placedAt.toISOString(), customer: o.customer, email: o.email, channel: o.channel, items: o.items, payment: o.paymentStatus, status: o.status, total: cents(o.totalCents), gross_profit: cents(o.grossProfitCents), margin: o.grossMargin })) };
    }
    case "inventory": {
      // Phase 8 (brief §8): every column a "product export" needs, without a second export mechanism —
      // this report already had stock/reserved/available/reorder/cost/price/value; category, collection and
      // the product's own status (draft/active/archived, distinct from the pre-existing stock-status column)
      // are appended here rather than replacing anything an existing consumer relies on.
      const res = await rows<Record<string, string | null>>(db, sql`select * from variant_stock where product_status <> 'archived' order by product_name, sku`);
      return { ...meta, columns: [
        { key: "product", label: "Product", type: "text" }, { key: "variant", label: "Variant", type: "text" }, { key: "sku", label: "SKU", type: "text" }, { key: "barcode", label: "Barcode", type: "text" },
        { key: "category", label: "Category", type: "text" }, { key: "collection", label: "Collection", type: "text" }, { key: "product_status", label: "Product status", type: "text" },
        { key: "stock", label: "Stock", type: "int" }, { key: "reserved", label: "Reserved", type: "int" }, { key: "available", label: "Available", type: "int" }, { key: "reorder", label: "Reorder level", type: "int" },
        { key: "status", label: "Stock status", type: "text" }, { key: "cost", label: "Cost", type: "money" }, { key: "price", label: "Price", type: "money" }, { key: "value", label: "Inventory value", type: "money" }],
        rows: res.map((x) => ({ product: x.product_name, variant: x.variant_label, sku: x.sku, barcode: x.barcode, category: x.category_name, collection: x.collection_name ?? "", product_status: x.product_status, stock: n(x.stock_quantity), reserved: n(x.reserved_quantity), available: n(x.available_stock), reorder: n(x.reorder_level), status: x.stock_status, cost: cents(n(x.cost_price_cents)), price: cents(n(x.selling_price_cents)), value: cents(n(x.inventory_value_cents)) })) };
    }
    case "product-performance": {
      const g = await getSalesBy(db, r, "product");
      return { ...meta, columns: [
        { key: "product", label: "Product", type: "text" }, { key: "units", label: "Units sold", type: "int" }, { key: "orders", label: "Orders", type: "int" }, { key: "revenue", label: "Net revenue", type: "money" },
        { key: "cogs", label: "COGS", type: "money" }, { key: "gross_profit", label: "Gross profit", type: "money" }, { key: "margin", label: "Gross margin %", type: "pct" }, { key: "share", label: "Share of revenue %", type: "pct" }],
        rows: g.map((x) => ({ product: x.label, units: x.units, orders: x.orders, revenue: cents(x.netRevenueCents), cogs: cents(x.cogsCents), gross_profit: cents(x.grossProfitCents), margin: x.grossMarginPct, share: x.shareOfRevenuePct })) };
    }
    case "profit": {
      const m = await getMetrics(db, r);
      // One typed column per kind of value, so spreadsheets get real currency, percentage and count cells.
      const money$ = (line: string, v: number) => ({ line, amount: cents(v), percent: null, count: null });
      const pctRow = (line: string, v: number) => ({ line, amount: null, percent: v, count: null });
      const countRow = (line: string, v: number) => ({ line, amount: null, percent: null, count: v });
      return { ...meta, columns: [{ key: "line", label: "Line", type: "text" }, { key: "amount", label: "Amount", type: "money" }, { key: "percent", label: "Percent", type: "pct" }, { key: "count", label: "Count", type: "int" }],
        rows: [money$("Gross sales", m.grossSalesCents), money$("Discounts", -m.discountCents), money$("Revenue", m.revenueCents), money$("Refunds", -m.refundCents), money$("Net revenue", m.netRevenueCents),
          money$("Cost of goods sold (COGS)", -m.cogsCents), money$("Gross profit", m.grossProfitCents), pctRow("Gross margin", m.grossMarginPct),
          money$("Payment fees", -m.paymentFeeCents), money$("Carrier shipping costs", -m.shippingCostCents), money$("Contribution profit", m.contributionProfitCents),
          money$("Shipping charged to customers (pass-through)", m.shippingChargedCents), money$("Tax collected (pass-through)", m.taxCents),
          countRow("Orders", m.orders), countRow("Units sold", m.units), money$("Average order value", m.averageOrderValueCents)] };
    }
    case "customers": {
      const res = await rows<Record<string, string | null>>(db, sql`
        select s.name, s.email, c.phone, c.first_touch_source, s.customer_since, s.total_orders, s.total_spent_cents, s.gross_profit_cents, s.last_order_at,
               count(o.id) as period_orders, coalesce(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents),0) as period_rev,
               coalesce((select string_agg(t.name, ', ') from customer_tag_assignments a join customer_tags t on t.id = a.tag_id where a.customer_id = s.customer_id), '') as tags
        from customer_stats s join customers c on c.id = s.customer_id join orders o on o.customer_id = s.customer_id and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}
        where c.merged_into_customer_id is null
        group by s.customer_id, s.name, s.email, c.phone, c.first_touch_source, s.customer_since, s.total_orders, s.total_spent_cents, s.gross_profit_cents, s.last_order_at order by period_rev desc`);
      return { ...meta, columns: [
        { key: "customer", label: "Customer", type: "text" }, { key: "email", label: "Email", type: "text" }, { key: "phone", label: "Phone", type: "text" },
        { key: "period_orders", label: "Orders in period", type: "int" }, { key: "period_revenue", label: "Revenue in period", type: "money" },
        { key: "lifetime_orders", label: "Lifetime orders", type: "int" }, { key: "lifetime_value", label: "Lifetime value", type: "money" }, { key: "lifetime_profit", label: "Lifetime profit", type: "money" },
        { key: "last_order", label: "Last order", type: "date" }, { key: "since", label: "Customer since", type: "date" },
        { key: "acquisition_source", label: "Acquisition source", type: "text" }, { key: "tags", label: "Tags", type: "text" }],
        rows: res.map((x) => ({
          customer: x.name, email: x.email, phone: x.phone ?? "", period_orders: n(x.period_orders), period_revenue: cents(n(x.period_rev)), lifetime_orders: n(x.total_orders),
          lifetime_value: cents(n(x.total_spent_cents)), lifetime_profit: cents(n(x.gross_profit_cents)), last_order: x.last_order_at ? new Date(x.last_order_at).toISOString() : null,
          since: new Date(x.customer_since!).toISOString(), acquisition_source: x.first_touch_source ?? "", tags: x.tags ?? "",
        })) };
    }
    case "low-stock": {
      const [low, out] = await Promise.all([lowStock(db, 10_000), outOfStock(db, 10_000)]);
      return { ...meta, columns: [
        { key: "status", label: "Status", type: "text" }, { key: "product", label: "Product", type: "text" }, { key: "variant", label: "Variant", type: "text" }, { key: "sku", label: "SKU", type: "text" },
        { key: "available", label: "Available", type: "int" }, { key: "reorder", label: "Reorder level", type: "int" }, { key: "sold30", label: "Sold (30 days)", type: "int" },
        { key: "days", label: "Est. days remaining", type: "int" }, { key: "suggest", label: "Suggested reorder (est.)", type: "int" }, { key: "last_sold", label: "Last sold", type: "date" }],
        rows: [...out, ...low].map((x) => ({ status: x.status, product: x.productName, variant: x.label, sku: x.sku, available: x.availableStock, reorder: x.reorderLevel, sold30: x.sold30, days: x.estimatedDaysRemaining, suggest: x.suggestedReorderQuantity, last_sold: x.lastSoldAt?.toISOString() ?? null })) };
    }
    /* ---------------- Phase 9: finance ---------------- */
    case "management-pl": {
      const s = await getFinancialSummary(db, r);
      const money$ = (line: string, v: number) => ({ line, amount: cents(v), pct_of_revenue: s.netRevenueCents ? Math.round((v / s.netRevenueCents) * 1000) / 10 : null });
      const byCategory = await getExpensesByCategory(db, r);
      return { ...meta, columns: [{ key: "line", label: "Line", type: "text" }, { key: "amount", label: "Amount", type: "money" }, { key: "pct_of_revenue", label: "% of revenue", type: "pct" }],
        rows: [
          money$("Gross sales", s.grossSalesCents), money$("Discounts", -s.discountCents), money$("Refunds", -s.refundCents), money$("Net revenue", s.netRevenueCents),
          money$("Cost of goods sold (COGS)", -s.cogsCents), money$("Gross profit", s.grossProfitCents),
          ...byCategory.map((c) => money$(`  ${c.category}`, -c.totalCents)),
          money$("Total operating expenses", -s.operatingExpensesCents), money$("Operating profit", s.operatingProfitCents),
        ] };
    }
    case "expenses": {
      const { rows: xs } = await listExpenses(db, { range: r, page: 1, pageSize: 100_000 });
      return { ...meta, columns: [
        { key: "expense_number", label: "Expense", type: "text" }, { key: "date", label: "Date", type: "date" }, { key: "category", label: "Category", type: "text" }, { key: "description", label: "Description", type: "text" },
        { key: "amount", label: "Amount", type: "money" }, { key: "status", label: "Status", type: "text" }, { key: "supplier", label: "Supplier", type: "text" }, { key: "payment_method", label: "Payment method", type: "text" }, { key: "created_by", label: "Created by", type: "text" }],
        rows: xs.map((x) => ({ expense_number: x.expenseNumber, date: x.expenseDate.toISOString(), category: x.category, description: x.description, amount: cents(x.amountCents), status: x.status, supplier: x.supplierName ?? "", payment_method: x.paymentMethod ?? "", created_by: x.createdBy ?? "" })) };
    }
    case "cash-flow": {
      const { getCashFlowSeries } = await import("../finance/cash-flow");
      const s = await getCashFlowSeries(db, r);
      const rowsOut = s.points.map((p) => ({ period: p.bucket.slice(0, 10), cash_in: cents(p.cashInCents), cash_out: cents(p.cashOutCents), net: cents(p.netCents) }));
      const t = rowsOut.reduce((a, x) => ({ cash_in: a.cash_in + x.cash_in, cash_out: a.cash_out + x.cash_out, net: a.net + x.net }), { cash_in: 0, cash_out: 0, net: 0 });
      return { ...meta, columns: [{ key: "period", label: "Period", type: "text" }, { key: "cash_in", label: "Cash in", type: "money" }, { key: "cash_out", label: "Cash out", type: "money" }, { key: "net", label: "Net cash flow", type: "money" }], rows: rowsOut, totals: t };
    }
    case "customer-payments": {
      const { rows: xs } = await listCustomerPayments(db, { range: r, page: 1, pageSize: 100_000 });
      return { ...meta, columns: [
        { key: "order", label: "Order", type: "text" }, { key: "date", label: "Date", type: "datetime" }, { key: "provider", label: "Provider", type: "text" }, { key: "reference", label: "Reference", type: "text" },
        { key: "amount", label: "Amount", type: "money" }, { key: "refunded", label: "Refunded", type: "money" }, { key: "status", label: "Status", type: "text" }],
        rows: xs.map((x) => ({ order: x.orderNumber, date: (x.paidAt ?? x.createdAt).toISOString(), provider: x.provider, reference: x.transactionRef ?? "", amount: cents(x.amountCents), refunded: cents(x.refundedCents), status: x.status })) };
    }
    case "supplier-payments": {
      const { rows: xs } = await listSupplierPayments(db, { page: 1, pageSize: 100_000 });
      return { ...meta, columns: [
        { key: "po", label: "Purchase order", type: "text" }, { key: "supplier", label: "Supplier", type: "text" }, { key: "total", label: "PO amount", type: "money" },
        { key: "paid", label: "Amount paid", type: "money" }, { key: "remaining", label: "Remaining", type: "money" }, { key: "due", label: "Due date", type: "date" }, { key: "status", label: "Status", type: "text" }],
        rows: xs.map((x) => ({ po: x.poNumber, supplier: x.supplierName, total: cents(x.totalCents), paid: cents(x.amountPaidCents), remaining: cents(x.remainingCents), due: x.dueDate?.toISOString() ?? null, status: x.status })) };
    }
    case "refunds": {
      const [{ rows: xs }, a] = await Promise.all([listRefunds(db, { range: r, page: 1, pageSize: 100_000 }), getRefundAnalytics(db, r)]);
      return { ...meta, columns: [
        { key: "order", label: "Order", type: "text" }, { key: "date", label: "Date", type: "datetime" }, { key: "customer", label: "Customer", type: "text" }, { key: "amount", label: "Amount", type: "money" },
        { key: "reason", label: "Reason", type: "text" }, { key: "restocked", label: "Restocked", type: "text" }, { key: "processed_by", label: "Processed by", type: "text" }],
        rows: xs.map((x) => ({ order: x.orderNumber, date: x.createdAt.toISOString(), customer: x.customerName, amount: cents(x.amountCents), reason: x.reason ?? "", restocked: x.restocked ? "Yes" : "No", processed_by: x.processedBy ?? "" })),
        totals: { amount: cents(a.totalRefundsCents) } };
    }
    case "tax-summary": {
      const t = await getTaxReport(db, r);
      return { ...meta, columns: [{ key: "line", label: "Line", type: "text" }, { key: "amount", label: "Amount", type: "money" }, { key: "count", label: "Count", type: "int" }],
        rows: t.configured ? [
          { line: "Taxable sales", amount: cents(t.taxableSalesCents), count: t.orders },
          { line: "Tax-exempt sales", amount: cents(t.taxExemptSalesCents), count: null },
          { line: `Tax collected (${t.ratePercent}% configured rate)`, amount: cents(t.taxAmountCents), count: null },
        ] : [{ line: "Tax configuration required", amount: null, count: null }] };
    }
    case "purchases": {
      const res = await rows<Record<string, string | null>>(db, sql`
        select o.po_number, s.name as supplier_name, o.order_date, o.status, o.payment_status, o.total_cents, o.amount_paid_cents
        from purchase_orders o join suppliers s on s.id = o.supplier_id
        where o.order_date >= ${r.from.toISOString()} and o.order_date < ${r.to.toISOString()} order by o.order_date desc`);
      return { ...meta, columns: [
        { key: "po", label: "Purchase order", type: "text" }, { key: "supplier", label: "Supplier", type: "text" }, { key: "date", label: "Order date", type: "date" }, { key: "status", label: "Status", type: "text" },
        { key: "payment_status", label: "Payment status", type: "text" }, { key: "total", label: "Total", type: "money" }, { key: "paid", label: "Amount paid", type: "money" }],
        rows: res.map((x) => ({ po: x.po_number, supplier: x.supplier_name, date: x.order_date ? new Date(x.order_date).toISOString() : null, status: x.status, payment_status: x.payment_status, total: cents(n(x.total_cents)), paid: cents(n(x.amount_paid_cents)) })) };
    }
    case "product-profitability": {
      const xs = await getProductProfitability(db, r);
      return { ...meta, columns: [
        { key: "product", label: "Product", type: "text" }, { key: "skus", label: "SKUs", type: "text" }, { key: "units", label: "Units sold", type: "int" }, { key: "gross_sales", label: "Gross sales", type: "money" },
        { key: "discounts", label: "Discounts", type: "money" }, { key: "refunds", label: "Refunds", type: "money" }, { key: "net_revenue", label: "Net revenue", type: "money" }, { key: "cogs", label: "COGS", type: "money" },
        { key: "gross_profit", label: "Gross profit", type: "money" }, { key: "margin", label: "Gross margin %", type: "pct" }, { key: "stock", label: "Current stock", type: "int" }, { key: "value", label: "Inventory value", type: "money" }],
        rows: xs.map((x) => ({ product: x.productName, skus: x.skus, units: x.unitsSold, gross_sales: cents(x.grossSalesCents), discounts: cents(x.discountCents), refunds: cents(x.refundCents), net_revenue: cents(x.netRevenueCents), cogs: cents(x.cogsCents), gross_profit: cents(x.grossProfitCents), margin: x.grossMarginPct, stock: x.currentStock, value: cents(x.inventoryValueCents) })) };
    }
    case "sales-channel": {
      const g = await getSalesByChannel(db, r);
      return { ...meta, columns: [
        { key: "channel", label: "Channel", type: "text" }, { key: "revenue", label: "Net revenue", type: "money" }, { key: "orders", label: "Orders", type: "int" }, { key: "units", label: "Units sold", type: "int" },
        { key: "gross_profit", label: "Gross profit", type: "money" }, { key: "margin", label: "Gross margin %", type: "pct" }, { key: "share", label: "Share of revenue %", type: "pct" }],
        rows: g.map((x) => ({ channel: x.label, revenue: cents(x.netRevenueCents), orders: x.orders, units: x.units, gross_profit: cents(x.grossProfitCents), margin: x.grossMarginPct, share: x.shareOfRevenuePct })) };
    }
  }
}

/* ---------------- file formats ---------------- */
const fmtDate = (iso: string, withTime: boolean) => new Intl.DateTimeFormat("en-CA", { timeZone: STORE.timezone, year: "numeric", month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).format(new Date(iso)).replace(",", "");
function displayCell(v: Cell, t: ColType) {
  if (v == null) return "";
  if (t === "date" || t === "datetime") return fmtDate(String(v), t === "datetime");
  if (t === "money") return Number(v).toLocaleString("en-US", { style: "currency", currency: STORE.currency });
  if (t === "pct") return `${Number(v).toFixed(1)}%`;
  if (t === "int") return Number(v).toLocaleString("en-US");
  return String(v);
}

export function toCsv(rep: Report): string {
  const esc = (s: string) => (/[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s); // also defuses spreadsheet formula injection
  const cell = (v: Cell, t: ColType) => (v == null ? "" : t === "date" || t === "datetime" ? fmtDate(String(v), t === "datetime") : typeof v === "number" ? String(v) : esc(v));
  return "\uFEFF" + [rep.columns.map((c) => esc(c.label)).join(","), ...rep.rows.map((r) => rep.columns.map((c) => cell(r[c.key] ?? null, c.type)).join(","))].join("\r\n") + "\r\n";
}

export async function toXlsx(rep: Report, rangeText: string): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SAURI"; wb.created = new Date();
  const ws = wb.addWorksheet(rep.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = rep.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
  for (const r of rep.rows) ws.addRow(Object.fromEntries(rep.columns.map((c) => { const v = r[c.key] ?? null; return [c.key, v != null && (c.type === "date" || c.type === "datetime") ? new Date(String(v)) : v]; })));
  rep.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === "money") col.numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
    if (c.type === "pct") col.numFmt = '0.0"%"';
    if (c.type === "int") col.numFmt = "#,##0";
    if (c.type === "date") col.numFmt = "yyyy-mm-dd";
    if (c.type === "datetime") col.numFmt = "yyyy-mm-dd hh:mm";
    col.width = Math.min(48, Math.max(col.width ?? 12, ...rep.rows.slice(0, 200).map((r) => displayCell(r[c.key] ?? null, c.type).length + 2)));
  });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F1EE" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rep.columns.length } };
  const info = wb.addWorksheet("About");
  info.addRows([["Report", rep.title], ["Period", rep.dateBound ? rangeText : "Snapshot as of export time"], ["Generated", new Date().toISOString()], ["Time zone", STORE.timezone], ["Notes", rep.description]]);
  info.getColumn(1).font = { bold: true }; info.getColumn(1).width = 14; info.getColumn(2).width = 70;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function toPdf(rep: Report, rangeText: string): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: rep.columns.length > 7 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(`SAURI  ·  ${rep.title}`, 40, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
  doc.text(`${rep.dateBound ? rangeText : "Snapshot as of export time"}  ·  Generated ${fmtDate(new Date().toISOString(), true)} (${STORE.timezone})`, 40, 62);
  const right = new Set(rep.columns.map((c, i) => (c.type === "text" || c.type === "date" || c.type === "datetime" ? -1 : i)).filter((i) => i >= 0));
  const body = rep.rows.map((r) => rep.columns.map((c) => displayCell(r[c.key] ?? null, c.type)));
  if (rep.totals) body.push(rep.columns.map((c, i) => (i === 0 ? "Total" : rep.totals![c.key] != null ? displayCell(rep.totals![c.key]!, c.type) : "")));
  autoTable(doc, {
    head: [rep.columns.map((c) => c.label)], body, startY: 76, margin: { left: 40, right: 40 },
    styles: { fontSize: 7.5, cellPadding: 3, lineColor: [228, 226, 220], lineWidth: 0.4 }, headStyles: { fillColor: [241, 241, 238], textColor: 40, fontStyle: "bold" },
    columnStyles: Object.fromEntries([...right].map((i) => [i, { halign: "right" as const }])),
    didParseCell: (d) => { if (rep.totals && d.section === "body" && d.row.index === body.length - 1) d.cell.styles.fontStyle = "bold"; },
    didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(140); doc.text(`Page ${doc.getNumberOfPages()}`, w - 80, doc.internal.pageSize.getHeight() - 20); },
  });
  return new Uint8Array(doc.output("arraybuffer"));
}
