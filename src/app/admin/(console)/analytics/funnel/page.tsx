import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getMarketingFunnel } from "@/lib/analytics/marketing";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { int, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardBody } from "@/components/ui/card";
import { ErrorState } from "@/components/admin/states";

export const metadata = { title: "Marketing funnel" };

export default async function FunnelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("funnel", () => getMarketingFunnel(db, r), one(sp.fail));

  const stages = res.ok ? [
    { label: "Sessions", value: res.data.sessions, rate: null as number | null, def: "Distinct session IDs with a page view" },
    { label: "Product Views", value: res.data.productViews, rate: res.data.viewRate, def: "Views ÷ sessions" },
    { label: "Add to Cart", value: res.data.addToCart, rate: res.data.cartRate, def: "Cart adds ÷ product views" },
    { label: "Checkout Started", value: res.data.checkoutStarted, rate: res.data.checkoutRate, def: "Checkouts started ÷ cart adds" },
    { label: "Purchases", value: res.data.purchases, rate: res.data.purchaseRate, def: "Paid orders ÷ checkouts started" },
  ] : [];
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Marketing funnel" description={`${rangeLabel(parsed)} · each stage is an independent count in this period, not a strict per-visitor waterfall`}>
        <AnalyticsNav current="funnel" query={rangeQuery(parsed)} />
      </PageHeader>
      <Card>
        <CardBody>
          {!res.ok ? <ErrorState message="Unable to load the funnel." /> : (
            <div className="grid grid-cols-1 gap-3">
              {stages.map((s) => (
                <div key={s.label}>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted">{int(s.value)}{s.rate != null && ` · ${pct(s.rate)}`}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-line-soft"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, (s.value / max) * 100)}%` }} /></div>
                  <p className="mt-0.5 text-xs text-subtle">{s.def}</p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
