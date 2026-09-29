/**
 * Reports (brief §41). One definition per report produces typed rows; the same rows feed the on-screen preview
 * and the CSV / Excel / PDF exports, so an export can never disagree with the screen.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { STORE } from "../config";
import { getMetrics, getSalesBy, getSeries, type Range } from "../analytics/service";
import { listOrders } from "./orders";
import { lowStock, outOfStock } from "./inventory";
import { n, rows } from "./sql";

export type ColType = "text" | "int" | "money" | "pct" | "date" | "datetime";
export type Column = { key: string; label: string; type: ColType };
export type Cell = string | number | null | undefined;
export type Report = { key: ReportKey; title: string; description: string; dateBound: boolean; columns: Column[]; rows: Record<string, Cell>[]; totals?: Record<string, number> };
export const REPORT_KEYS = ["daily-sales", "weekly-sales", "monthly-sales", "orders", "inventory", "product-performance", "profit", "customers", "low-stock"] as const;
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
      const res = await rows<Record<string, string | null>>(db, sql`select * from variant_stock where product_status <> 'archived' order by product_name, sku`);
      return { ...meta, columns: [
        { key: "product", label: "Product", type: "text" }, { key: "variant", label: "Variant", type: "text" }, { key: "sku", label: "SKU", type: "text" }, { key: "barcode", label: "Barcode", type: "text" },
        { key: "stock", label: "Stock", type: "int" }, { key: "reserved", label: "Reserved", type: "int" }, { key: "available", label: "Available", type: "int" }, { key: "reorder", label: "Reorder level", type: "int" },
        { key: "status", label: "Status", type: "text" }, { key: "cost", label: "Cost", type: "money" }, { key: "price", label: "Price", type: "money" }, { key: "value", label: "Inventory value", type: "money" }],
        rows: res.map((x) => ({ product: x.product_name, variant: x.variant_label, sku: x.sku, barcode: x.barcode, stock: n(x.stock_quantity), reserved: n(x.reserved_quantity), available: n(x.available_stock), reorder: n(x.reorder_level), status: x.stock_status, cost: cents(n(x.cost_price_cents)), price: cents(n(x.selling_price_cents)), value: cents(n(x.inventory_value_cents)) })) };
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
