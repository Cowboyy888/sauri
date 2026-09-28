import { getDb } from "@/lib/db/client";
import { getInventory, getMetrics, resolveRange } from "@/lib/analytics/service";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business dashboard", robots: { index: false } };

const pctChange = (cur: number, prev: number) => (prev ? `${cur >= prev ? "▲" : "▼"} ${Math.abs(((cur - prev) / prev) * 100).toFixed(1)}%` : "—");

export default async function AdminHome() {
  const db = getDb();
  const r = await resolveRange(db, "30d");
  const [m, pm, inv] = await Promise.all([getMetrics(db, r), getMetrics(db, r.previous), getInventory(db)]);
  const low = inv.filter((x) => x.status === "low").length, out = inv.filter((x) => x.status === "out").length;
  const cards: [string, string, string][] = [
    ["Total sales", formatMoney(m.netRevenueCents), pctChange(m.netRevenueCents, pm.netRevenueCents)],
    ["Orders", String(m.orders), pctChange(m.orders, pm.orders)],
    ["Average order value", formatMoney(m.averageOrderValueCents), pctChange(m.averageOrderValueCents, pm.averageOrderValueCents)],
    ["Gross profit", formatMoney(m.grossProfitCents), `${m.grossMarginPct.toFixed(1)}% margin`],
    ["Products sold", String(m.units), pctChange(m.units, pm.units)],
    ["Low stock", String(low + out), `${out} out of stock`],
  ];
  return (
    <main className="min-h-screen bg-admin-bg p-8 font-[system-ui]">
      <h1 className="text-2xl font-semibold">Business overview</h1>
      <p className="text-sm text-neutral-500">Last 30 days, compared with the previous 30. All figures computed in Postgres.</p>
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
