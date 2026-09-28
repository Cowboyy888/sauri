import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { requireStaff, UnauthenticatedError } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";
import { getInventory, getMetrics, resolveRange } from "@/lib/analytics/service";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business dashboard", robots: { index: false } };

const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? "▲" : "▼"} ${Math.abs(((cur - prev) / prev) * 100).toFixed(1)}%` : "—");

/** Wiring check only. The real dashboard is Phase 2. */
export default async function AdminHome() {
  const db = getDb();
  try { await requireStaff(db, "dashboard:read"); }
  catch (e) { if (e instanceof UnauthenticatedError) redirect("/admin/login"); if (e instanceof ForbiddenError) notFound(); throw e; }
  const r = await resolveRange(db, "30d");
  const [m, pm, inv] = await Promise.all([getMetrics(db, r), getMetrics(db, r.previous), getInventory(db, { onlyAttention: true })]);
  const cards: [string, string, string][] = [
    ["Net revenue", formatMoney(m.netRevenueCents), change(m.netRevenueCents, pm.netRevenueCents)],
    ["Orders", String(m.orders), change(m.orders, pm.orders)],
    ["Average order value", formatMoney(m.averageOrderValueCents), change(m.averageOrderValueCents, pm.averageOrderValueCents)],
    ["Gross profit", formatMoney(m.grossProfitCents), `${m.grossMarginPct.toFixed(1)}% margin`],
    ["Units sold", String(m.units), change(m.units, pm.units)],
    ["Needs restock", String(inv.length), `${inv.filter((x) => x.status === "OUT_OF_STOCK").length} out of stock`],
  ];
  return (
    <main className="min-h-screen bg-admin-bg p-8 font-[system-ui]">
      <h1 className="text-2xl font-semibold">Business overview</h1>
      <p className="text-sm text-neutral-500">Last 30 days vs the previous 30. Computed in Postgres.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([l, v, d]) => (
          <div key={l} className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-xs font-medium text-neutral-500">{l}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
            <p className="mt-1 text-xs text-neutral-500">{d}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
