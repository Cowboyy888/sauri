/**
 * Product profitability (brief §19). Deliberately its own methodology, not a re-export of
 * `analytics/service.ts#getSalesBy("product")`: that function excludes any order with a refund entirely
 * (docs/ANALYTICS.md), which would make this report's "Refunds" column always read zero. Here, a refund is
 * instead allocated pro rata across its order's lines (same technique as `lib/finance/refunds.ts`), so
 * Net Revenue = Gross Sales − Discounts − Refunds is a real, non-trivial number per product. Units sold and
 * gross sales can therefore differ slightly from the existing per-product analytics page for a period with
 * partial refunds — an intentional, documented difference (docs/FINANCIAL_REPORTS.md), not a bug.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { n, rows } from "../admin/sql";
import type { Range } from "../analytics/service";

export type ProductProfitabilityRow = {
  productId: string; productName: string; skus: string; unitsSold: number; grossSalesCents: number; discountCents: number;
  refundCents: number; netRevenueCents: number; cogsCents: number; grossProfitCents: number; grossMarginPct: number | null;
  currentStock: number; inventoryValueCents: number;
};

export async function getProductProfitability(db: DbOrTx, r: Range): Promise<ProductProfitabilityRow[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    with lines as (
      select i.product_id, max(i.product_name_snapshot) as product_name, string_agg(distinct i.sku_snapshot, ', ' order by i.sku_snapshot) as skus,
        sum(i.quantity) as units, sum(i.quantity * i.unit_price_cents) as gross_sales, sum(i.discount_cents) as discounts,
        sum(i.line_cost_cents) as cogs, sum(i.line_total_cents) as line_total
      from order_items i join orders o on o.id = i.order_id
      where o.paid_at is not null and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}
      group by i.product_id
    ), order_line_totals as (
      select order_id, sum(line_total_cents) as line_total from order_items group by order_id
    ), refund_alloc as (
      select i.product_id, sum(o.refund_total_cents * i.line_total_cents::numeric / nullif(t.line_total, 0)) as refund
      from order_items i join orders o on o.id = i.order_id join order_line_totals t on t.order_id = o.id
      where o.paid_at is not null and o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()} and o.refund_total_cents > 0
      group by i.product_id
    ), stock as (
      select product_id, sum(available_stock) as stock, sum(inventory_value_cents) as value
      from variant_stock where product_status <> 'archived' group by product_id
    )
    select l.product_id, l.product_name, l.skus, l.units, l.gross_sales, l.discounts, coalesce(ra.refund, 0) as refunds, l.cogs, l.line_total,
      coalesce(s.stock, 0) as stock, coalesce(s.value, 0) as value
    from lines l left join refund_alloc ra on ra.product_id = l.product_id left join stock s on s.product_id = l.product_id
    order by l.line_total desc`);
  return res.map((x) => {
    const refundCents = Math.round(n(x.refunds)), netRevenueCents = n(x.line_total) - refundCents, grossProfitCents = netRevenueCents - n(x.cogs);
    return {
      productId: x.product_id!, productName: x.product_name!, skus: x.skus ?? "", unitsSold: n(x.units), grossSalesCents: n(x.gross_sales), discountCents: n(x.discounts),
      refundCents, netRevenueCents, cogsCents: n(x.cogs), grossProfitCents, grossMarginPct: netRevenueCents ? Math.round((grossProfitCents / netRevenueCents) * 10_000) / 100 : null,
      currentStock: n(x.stock), inventoryValueCents: n(x.value),
    };
  });
}
