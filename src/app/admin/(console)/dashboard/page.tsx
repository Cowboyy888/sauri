import { Suspense } from "react";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { guard } from "@/lib/admin/guard";
import { comparisonLabel, one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { dateTimeFull } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { RefreshControl } from "@/components/admin/live";
import { CardSkeleton, KpiSkeleton } from "@/components/admin/skeleton";
import {
  CategorySection, ChannelSection, InventorySummarySection, KpiSection, LowStockSection, OutOfStockSection, ProfitSection, RecentOrdersSection,
  RevenueBreakdownSection, SalesOverviewSection, TopProductsSection,
} from "@/components/admin/dashboard/sections";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("dashboard:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams;
  const parsed = parseRange(sp);
  const db = getDb();
  const r = await resolveRange(db, parsed.key, parsed.custom);
  const text = rangeLabel(parsed);
  const ctx = { db, r, parsed, fail: one(sp.fail), canWriteInventory: g.can("inventory:write"), canOrders: g.can("orders:read"), canProducts: g.can("products:read") };
  // Re-mount sections when the range changes so skeletons show while new numbers stream in.
  const k = JSON.stringify(rangeQuery(parsed));

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Business overview" description={<>{text} · {comparisonLabel(parsed).replace(/^vs/, "compared with")}</>} actions={<RefreshControl renderedAt={dateTimeFull(new Date())} />} />
      {/* Mobile order (brief §45): KPIs, stock alerts and recent orders first; charts after. Desktop: analytic flow. */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="order-1"><Suspense key={`k${k}`} fallback={<KpiSkeleton />}><KpiSection {...ctx} /></Suspense></div>
        <div className="order-5 lg:order-2"><Suspense key={`c${k}`} fallback={<CardSkeleton chart />}><SalesOverviewSection {...ctx} rangeText={text} /></Suspense></div>
        <div className="order-6 grid gap-4 lg:order-3 lg:grid-cols-2">
          <Suspense key={`b${k}`} fallback={<CardSkeleton rows={8} />}><RevenueBreakdownSection {...ctx} /></Suspense>
          <Suspense key={`p${k}`} fallback={<CardSkeleton chart />}><ProfitSection {...ctx} /></Suspense>
        </div>
        <div className="order-2 grid gap-4 lg:order-4 2xl:grid-cols-2">
          <Suspense fallback={<CardSkeleton rows={6} />}><LowStockSection {...ctx} /></Suspense>
          <Suspense fallback={<CardSkeleton rows={6} />}><OutOfStockSection {...ctx} /></Suspense>
        </div>
        <div className="order-3 lg:order-5"><Suspense key={`o${k}`} fallback={<CardSkeleton rows={8} />}><RecentOrdersSection {...ctx} /></Suspense></div>
        <div className="order-7 lg:order-6"><Suspense key={`t${k}${one(sp.top)}`} fallback={<CardSkeleton rows={10} />}><TopProductsSection {...ctx} sort={one(sp.top) ?? "revenue"} baseParams={rangeQuery(parsed)} /></Suspense></div>
        <div className="order-8 grid gap-4 lg:order-7 lg:grid-cols-2">
          <Suspense key={`cat${k}`} fallback={<CardSkeleton chart />}><CategorySection {...ctx} /></Suspense>
          <Suspense key={`ch${k}`} fallback={<CardSkeleton chart />}><ChannelSection {...ctx} /></Suspense>
        </div>
        <div className="order-4 lg:order-8"><Suspense fallback={<CardSkeleton rows={6} />}><InventorySummarySection {...ctx} /></Suspense></div>
      </div>
    </div>
  );
}
