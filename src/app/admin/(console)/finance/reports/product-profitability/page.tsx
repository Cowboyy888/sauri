import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getProductProfitability, type ProductProfitabilityRow } from "@/lib/finance/product-profitability";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Col } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/states";

export const metadata = { title: "Product profitability" };

export default async function ProductProfitabilityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("product-profitability", () => getProductProfitability(db, r), one(sp.fail));
  const sort = one(sp.sort) ?? "netRevenueCents", dir = one(sp.dir) === "asc" ? "asc" : "desc";
  const rows = res.ok ? [...res.data].sort((a, b) => {
    const av = Number(a[sort as keyof ProductProfitabilityRow] ?? 0), bv = Number(b[sort as keyof ProductProfitabilityRow] ?? 0);
    return dir === "asc" ? av - bv : bv - av;
  }) : [];

  const columns: Col<ProductProfitabilityRow>[] = [
    { key: "product", header: "Product", cell: (x) => <span className="font-medium">{x.productName}</span> },
    { key: "skus", header: "SKUs", cell: (x) => <span className="text-xs text-muted">{x.skus}</span>, hideBelow: "lg" },
    { key: "units", header: "Units sold", cell: (x) => int(x.unitsSold), align: "right", sortKey: "unitsSold" },
    { key: "gross_sales", header: "Gross sales", cell: (x) => money(x.grossSalesCents), align: "right", hideBelow: "md" },
    { key: "discounts", header: "Discounts", cell: (x) => money(x.discountCents), align: "right", hideBelow: "lg" },
    { key: "refunds", header: "Refunds (est.)", cell: (x) => money(x.refundCents), align: "right", hideBelow: "lg" },
    { key: "net_revenue", header: "Net revenue", cell: (x) => money(x.netRevenueCents), align: "right", sortKey: "netRevenueCents" },
    { key: "cogs", header: "COGS", cell: (x) => money(x.cogsCents), align: "right", hideBelow: "md" },
    { key: "gross_profit", header: "Gross profit", cell: (x) => money(x.grossProfitCents), align: "right", sortKey: "grossProfitCents" },
    { key: "margin", header: "Margin", cell: (x) => (x.grossMarginPct == null ? "N/A" : pct(x.grossMarginPct)), align: "right", sortKey: "grossMarginPct" },
    { key: "stock", header: "Current stock", cell: (x) => int(x.currentStock), align: "right", hideBelow: "md" },
    { key: "value", header: "Inventory value", cell: (x) => money(x.inventoryValueCents), align: "right", hideBelow: "lg" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Product profitability" description={rangeLabel(parsed)}>
        <Link href={`/admin/finance/reports?${new URLSearchParams(rangeQuery(parsed))}`} className="text-[13px] font-medium text-accent hover:underline">← All reports</Link>
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load product profitability." /> : (
        <Card>
          <CardBody className="p-0">
            <DataTable columns={columns} rows={rows} rowKey={(x) => x.productId} basePath="/admin/finance/reports/product-profitability" params={{ ...rangeQuery(parsed), sort }}
              sort={sort} dir={dir} empty={<EmptyState title="No sales in this period" />} caption="Product profitability" />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
