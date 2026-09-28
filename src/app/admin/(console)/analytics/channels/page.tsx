import { getDb } from "@/lib/db/client";
import { getSalesByChannel, resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { comparisonLabel, one, parseRange, pctChange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { rows } from "@/lib/admin/sql";
import { int, money, pct, signedPct } from "@/lib/format";
import { sql } from "drizzle-orm";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { AnalyticsNav } from "@/components/admin/analytics-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BarBreakdown } from "@/components/admin/charts";
import { ErrorState } from "@/components/admin/states";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Channel analytics" };

export default async function ChannelAnalytics({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("sales:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("channels", async () => {
    const [cur, prev, all] = await Promise.all([getSalesByChannel(db, r), getSalesByChannel(db, r.previous), rows<{ code: string; name: string }>(db, sql`select code, name from sales_channels where active order by name`)]);
    // All eight channels are listed, including those with no sales.
    const byCode = new Map(cur.map((c) => [c.key, c])), prevBy = new Map(prev.map((c) => [c.key, c]));
    return all.map((c) => ({ ...(byCode.get(c.code) ?? { key: c.code, label: c.name, netRevenueCents: 0, cogsCents: 0, grossProfitCents: 0, grossMarginPct: 0, units: 0, orders: 0, shareOfRevenuePct: 0, averageOrderValueCents: 0 }), prevRev: prevBy.get(c.code)?.netRevenueCents ?? 0 })).sort((a, b) => b.netRevenueCents - a.netRevenueCents);
  }, one(sp.fail));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Channel analytics" description={`${rangeLabel(parsed)} · change ${comparisonLabel(parsed)}`}><AnalyticsNav current="channels" query={rangeQuery(parsed)} /></PageHeader>
      {!res.ok ? <Card><ErrorState message="Unable to load channel data." /></Card> : <>
        <Card><CardHeader title="Revenue by channel" /><CardBody><BarBreakdown ariaLabel="Revenue by channel" groups={res.data.filter((c) => c.netRevenueCents > 0)} /></CardBody></Card>
        <Card><CardHeader title="Channel performance" description="Profit is gross profit (revenue − COGS). AOV = revenue ÷ orders." />
          <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Channel performance</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Channel</th><th className="num px-3 font-medium">Revenue</th><th className="num px-3 font-medium">Change</th><th className="num px-3 font-medium">Orders</th><th className="num px-3 font-medium">Profit</th><th className="num hidden px-3 font-medium sm:table-cell">Margin</th><th className="num px-3 font-medium">AOV</th><th className="num hidden pr-4 font-medium md:table-cell">Share</th></tr></thead>
            <tbody>{res.data.map((c) => { const ch = pctChange(c.netRevenueCents, c.prevRev); return (
              <tr key={c.key} className="border-b border-line-soft last:border-0">
                <td className="py-2.5 pl-4 font-medium">{c.label}</td><td className="num px-3">{money(c.netRevenueCents)}</td>
                <td className={cn("num px-3", ch == null ? "text-subtle" : ch >= 0 ? "text-pos" : "text-neg")}>{ch == null ? "—" : signedPct(ch)}</td>
                <td className="num px-3">{int(c.orders)}</td><td className="num px-3">{money(c.grossProfitCents)}</td><td className="num hidden px-3 sm:table-cell">{c.netRevenueCents ? pct(c.grossMarginPct) : "—"}</td>
                <td className="num px-3">{c.orders ? money(c.averageOrderValueCents) : "—"}</td><td className="num hidden pr-4 md:table-cell">{pct(c.shareOfRevenuePct)}</td>
              </tr>); })}</tbody></table></div>
        </Card>
      </>}
    </div>
  );
}
