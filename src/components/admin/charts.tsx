"use client";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { bucketLabel, int, money, moneyAxis, pct } from "@/lib/format";
import { cn } from "../ui/cn";

export type Point = { bucket: string; netRevenueCents: number; orders: number; grossProfitCents: number; units: number; cogsCents?: number };
type MetricKey = "netRevenueCents" | "orders" | "grossProfitCents" | "units";
const METRICS: { key: MetricKey; label: string; money: boolean }[] = [
  { key: "netRevenueCents", label: "Revenue", money: true }, { key: "orders", label: "Orders", money: false },
  { key: "grossProfitCents", label: "Profit", money: true }, { key: "units", label: "Units sold", money: false },
];
const C1 = "#2f5d50", C2 = "#a98a55", GRID = "#ecebe6", MUTED = "#8c8880";

/** Round-number axis: 0 → a "nice" maximum (1, 2, 2.5, 5 × 10ⁿ) in 4 even steps. Always starts at zero. */
export function niceTicks(max: number, steps = 4, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / steps, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && !integer ? 2.5 : f <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

function Frame({ children, minWidth = 560, height }: { children: React.ReactNode; minWidth?: number; height: number }) {
  // Charts render in the browser only: Recharts generates element ids that would differ from a server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Phones: scroll sideways rather than squashing labels into illegibility.
  return <div className="relative overflow-x-auto"><div style={{ minWidth, height }}>{mounted ? children : <div className="skeleton h-full w-full" aria-hidden />}</div></div>;
}

function DataTableToggle({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none text-muted hover:text-fg">View as table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded border border-line-soft">
        <table className="w-full text-[12.5px]"><caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-canvas"><tr>{head.map((h, i) => <th key={h} scope="col" className={cn("px-2.5 py-1.5 text-left font-medium text-muted", i && "text-right")}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line-soft">{r.map((c, j) => <td key={j} className={cn("px-2.5 py-1.5", j && "num")}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/** §8 Sales Overview. Current period (solid) against the previous equivalent period (dashed). Tooltip shows every metric, exact. */
export function SalesChart({ points, previous, unit, rangeLabel }: { points: Point[]; previous?: Point[]; unit: string; rangeLabel: string }) {
  const [metric, setMetric] = useState<MetricKey>("netRevenueCents");
  const [type, setType] = useState<"area" | "line">("area");
  const m = METRICS.find((x) => x.key === metric)!;
  const data = useMemo(() => points.map((p, i) => ({ ...p, prev: previous?.[i]?.[metric] ?? null, label: bucketLabel(p.bucket, unit), long: bucketLabel(p.bucket, unit, true) })), [points, previous, metric, unit]);
  const total = points.reduce((a, p) => a + p[metric], 0), prevTotal = previous?.reduce((a, p) => a + p[metric], 0);
  const fmt = (v: number) => (m.money ? money(v) : int(v));
  const hasData = points.some((p) => p.orders > 0);
  const ticks = niceTicks(Math.max(0, ...data.map((d) => Math.max(d[metric], d.prev ?? 0))), 4, !m.money);
  const Chart = type === "area" ? AreaChart : LineChart;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Metric" className="inline-flex h-8 rounded-md border border-line bg-surface p-0.5">
          {METRICS.map((x) => (
            <button key={x.key} type="button" aria-pressed={metric === x.key} onClick={() => setMetric(x.key)} className={cn("rounded px-2.5 text-[12.5px] font-medium text-muted hover:text-fg", metric === x.key && "bg-fg text-white hover:text-white")}>{x.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span><b className="font-semibold text-fg">{fmt(total)}</b> in period{prevTotal != null && <> · previous {fmt(prevTotal)}</>}</span>
          <select aria-label="Chart type" value={type} onChange={(e) => setType(e.target.value as "area" | "line")} className="h-8 rounded-md border border-line bg-surface px-2 text-xs">
            <option value="area">Area</option><option value="line">Line</option>
          </select>
        </div>
      </div>
      <figure className="mt-3" role="img" aria-label={`${m.label} over ${rangeLabel}: ${fmt(total)} in total.`}>
        {!hasData ? <p className="grid h-[280px] place-items-center text-[13px] text-muted">No paid orders in this period.</p> : (
          <Frame height={290}>
            <ResponsiveContainer width="100%" height="100%">
              <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs><linearGradient id="fillMain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C1} stopOpacity={0.18} /><stop offset="1" stopColor={C1} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
                {/* Financial axes always start at zero so differences are never exaggerated. */}
                <YAxis domain={[0, ticks[ticks.length - 1]!]} ticks={ticks} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (m.money ? moneyAxis(v) : int(v))} />
                <Tooltip cursor={{ stroke: MUTED, strokeDasharray: "3 3" }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]!.payload as (typeof data)[number];
                  return (
                    <div className="admin min-w-[190px] rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[0_8px_24px_rgba(0,0,0,.12)]">
                      <p className="mb-1.5 font-semibold text-fg">{d.long}</p>
                      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                        <dt className="text-muted">Revenue</dt><dd className="num">{money(d.netRevenueCents)}</dd>
                        <dt className="text-muted">Orders</dt><dd className="num">{int(d.orders)}</dd>
                        <dt className="text-muted">Profit</dt><dd className="num">{money(d.grossProfitCents)}</dd>
                        <dt className="text-muted">Units sold</dt><dd className="num">{int(d.units)}</dd>
                        {d.prev != null && <><dt className="text-subtle">Prev. {m.label.toLowerCase()}</dt><dd className="num text-subtle">{fmt(d.prev)}</dd></>}
                      </dl>
                    </div>
                  );
                }} />
                {previous && <Line type="monotoneX" dataKey="prev" stroke={MUTED} strokeWidth={1.25} strokeDasharray="4 4" dot={false} isAnimationActive={false} name="Previous period" />}
                {type === "area"
                  ? <Area type="monotoneX" dataKey={metric} stroke={C1} strokeWidth={2} fill="url(#fillMain)" isAnimationActive={false} name={m.label} activeDot={{ r: 4 }} />
                  : <Line type="monotoneX" dataKey={metric} stroke={C1} strokeWidth={2} dot={false} isAnimationActive={false} name={m.label} activeDot={{ r: 4 }} />}
              </Chart>
            </ResponsiveContainer>
          </Frame>
        )}
        <figcaption className="mt-2 flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-accent" />{rangeLabel}</span>
          {previous && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-subtle" />Previous period</span>}
        </figcaption>
      </figure>
      <DataTableToggle caption="Sales by period" head={["Period", "Revenue", "Orders", "Profit", "Units"]} rows={points.map((p) => [bucketLabel(p.bucket, unit, true), money(p.netRevenueCents), int(p.orders), money(p.grossProfitCents), int(p.units)])} />
    </div>
  );
}

/** §10 Profit trend: gross profit (area) with margin % on hover. */
export function ProfitTrend({ points, unit }: { points: Point[]; unit: string }) {
  const data = points.map((p) => ({ ...p, label: bucketLabel(p.bucket, unit), long: bucketLabel(p.bucket, unit, true), margin: p.netRevenueCents ? (p.grossProfitCents / p.netRevenueCents) * 100 : null }));
  if (!points.some((p) => p.orders)) return <p className="grid h-[180px] place-items-center text-[13px] text-muted">No paid orders in this period.</p>;
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.grossProfitCents)));
  return (
    <figure role="img" aria-label="Gross profit trend">
      <Frame height={190} minWidth={420}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} minTickGap={28} />
            <YAxis domain={[Math.min(0, ...points.map((p) => p.grossProfitCents)), ticks[ticks.length - 1]!]} ticks={ticks} tickLine={false} axisLine={false} width={52} tickFormatter={moneyAxis} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as (typeof data)[number];
              return <div className="admin rounded-md border border-line bg-surface px-3 py-2 text-xs shadow"><p className="font-semibold">{d.long}</p><p>Gross profit <b className="num">{money(d.grossProfitCents)}</b></p><p>Revenue {money(d.netRevenueCents)} · COGS {money(d.cogsCents ?? d.netRevenueCents - d.grossProfitCents)}</p><p>Margin {d.margin == null ? "—" : pct(d.margin)}</p></div>;
            }} />
            <Area type="monotoneX" dataKey="grossProfitCents" stroke={C2} strokeWidth={2} fill={C2} fillOpacity={0.12} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Frame>
    </figure>
  );
}

export type Group = { key: string; label: string; netRevenueCents: number; grossProfitCents: number; orders: number; units: number; shareOfRevenuePct: number; averageOrderValueCents?: number; grossMarginPct?: number };

/** Horizontal bars: one hue, sorted, value labels. Optional click-to-drill-down. */
export function BarBreakdown({ groups, onSelect, selected, height, ariaLabel }: { groups: Group[]; onSelect?: (key: string) => void; selected?: string | null; height?: number; ariaLabel: string }) {
  if (!groups.length) return <p className="grid h-[160px] place-items-center text-[13px] text-muted">No sales in this period.</p>;
  const h = height ?? Math.max(120, groups.length * 34 + 10);
  return (
    <figure role="img" aria-label={`${ariaLabel}: ${groups.map((g) => `${g.label} ${money(g.netRevenueCents)}`).join(", ")}`}>
      <Frame height={h} minWidth={320}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={groups} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }} barCategoryGap={8}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#1c1b19" }} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,.03)" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const g = payload[0]!.payload as Group;
              return <div className="admin rounded-md border border-line bg-surface px-3 py-2 text-xs shadow"><p className="font-semibold">{g.label}</p><p>Revenue {money(g.netRevenueCents)} ({pct(g.shareOfRevenuePct)})</p><p>Orders {int(g.orders)} · Units {int(g.units)}</p><p>Profit {money(g.grossProfitCents)}</p></div>;
            }} />
            <Bar dataKey="netRevenueCents" radius={[0, 3, 3, 0]} isAnimationActive={false} onClick={onSelect ? (d) => onSelect((d as unknown as Group).key) : undefined} cursor={onSelect ? "pointer" : undefined}
              label={{ position: "right", formatter: (v: unknown) => moneyAxis(Number(v)), fontSize: 11, fill: "#66625b" }}>
              {groups.map((g) => <Cell key={g.key} fill={selected && selected !== g.key ? "#c9d6d1" : C1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Frame>
    </figure>
  );
}

/** §12 Sales by category, with click-through to that category's products. */
export function CategoryBreakdown({ groups, productsByCategory }: { groups: Group[]; productsByCategory: Record<string, Group[]> }) {
  const [sel, setSel] = useState<string | null>(null);
  const selected = groups.find((g) => g.key === sel);
  return (
    <div>
      <BarBreakdown groups={groups} onSelect={(k) => setSel((s) => (s === k ? null : k))} selected={sel} ariaLabel="Revenue by category" />
      <div className="mt-2 relative overflow-x-auto">
        <table className="w-full text-[12.5px]"><caption className="sr-only">Sales by category</caption>
          <thead><tr className="text-left text-xs text-muted"><th className="py-1.5 font-medium">Category</th><th className="num font-medium">Revenue</th><th className="num font-medium">Orders</th><th className="num font-medium">Units</th><th className="num font-medium">Profit</th><th className="num font-medium">Share</th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.key} className={cn("border-t border-line-soft", sel === g.key && "bg-accent-soft")}>
              <td className="py-1.5"><button type="button" onClick={() => setSel((s) => (s === g.key ? null : g.key))} aria-expanded={sel === g.key} className="font-medium text-accent hover:underline">{g.label}</button></td>
              <td className="num">{money(g.netRevenueCents)}</td><td className="num">{int(g.orders)}</td><td className="num">{int(g.units)}</td><td className="num">{money(g.grossProfitCents)}</td><td className="num">{pct(g.shareOfRevenuePct)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="mt-3 rounded-md border border-line-soft bg-canvas p-3">
          <p className="mb-2 text-xs font-semibold">{selected.label}: products</p>
          {(productsByCategory[selected.key] ?? []).length ? (
            <ul className="grid grid-cols-1 gap-1 text-[12.5px]">{productsByCategory[selected.key]!.map((p) => (
              <li key={p.key} className="flex justify-between gap-3"><a href={`/admin/products/${p.key}?tab=analytics`} className="truncate text-accent hover:underline">{p.label}</a><span className="num text-muted">{int(p.units)} sold · {money(p.netRevenueCents)} · {pct(p.shareOfRevenuePct)} of category</span></li>
            ))}</ul>
          ) : <p className="text-xs text-muted">No sales in this category for the period.</p>}
        </div>
      )}
    </div>
  );
}

/** §34 New vs returning (stacked bars) and customer growth (line). */
export function CustomerCharts({ points, unit }: { points: { bucket: string; newCustomers: number; returningCustomers: number; totalCustomers: number }[]; unit: string }) {
  const data = points.map((p) => ({ ...p, label: bucketLabel(p.bucket, unit), long: bucketLabel(p.bucket, unit, true) }));
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <figure role="img" aria-label="New and returning customers per period">
        <figcaption className="mb-2 text-xs font-medium text-muted">New vs returning customers</figcaption>
        <Frame height={220} minWidth={380}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="label" tickLine={false} minTickGap={24} axisLine={{ stroke: GRID }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
              <Tooltip labelFormatter={(_, p) => (p?.[0]?.payload as { long: string })?.long} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="newCustomers" name="New" stackId="c" fill={C1} isAnimationActive={false} />
              <Bar dataKey="returningCustomers" name="Returning" stackId="c" fill={C2} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Frame>
      </figure>
      <figure role="img" aria-label="Total customers who have ever bought, over time">
        <figcaption className="mb-2 text-xs font-medium text-muted">Customer growth (all buyers to date)</figcaption>
        <Frame height={220} minWidth={380}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="label" tickLine={false} minTickGap={24} axisLine={{ stroke: GRID }} /><YAxis domain={[0, "auto"]} allowDecimals={false} tickLine={false} axisLine={false} width={44} />
              <Tooltip labelFormatter={(_, p) => (p?.[0]?.payload as { long: string })?.long} formatter={(v) => [int(Number(v)), "Customers"]} />
              <Line type="monotoneX" dataKey="totalCustomers" stroke={C1} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Frame>
      </figure>
    </div>
  );
}

/** Small single-series trend (sales analytics grid, inventory value). */
export function MiniTrend({ points, unit, dataKey, label, format }: { points: Record<string, string | number>[]; unit: string; dataKey: string; label: string; format: "money" | "int" }) {
  const data = points.map((p) => ({ ...p, _l: bucketLabel(String(p.bucket ?? p.day), unit), _long: bucketLabel(String(p.bucket ?? p.day), unit, true) }));
  const f = (v: number) => (format === "money" ? money(v) : int(v));
  const ticks = niceTicks(Math.max(0, ...data.map((d) => Number(d[dataKey as keyof typeof d]) || 0)), 4, format === "int");
  return (
    <figure role="img" aria-label={`${label} trend`}>
      <Frame height={170} minWidth={340}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="_l" tickLine={false} minTickGap={28} axisLine={{ stroke: GRID }} />
            <YAxis domain={[0, ticks[ticks.length - 1]!]} ticks={ticks} tickLine={false} axisLine={false} width={50} tickFormatter={(v: number) => (format === "money" ? moneyAxis(v) : int(v))} />
            <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="admin rounded-md border border-line bg-surface px-3 py-2 text-xs shadow"><p className="font-semibold">{(payload[0]!.payload as { _long: string })._long}</p><p>{label} <b className="num">{f(Number(payload[0]!.value))}</b></p></div> : null} />
            <Area type="monotoneX" dataKey={dataKey} stroke={C1} strokeWidth={1.75} fill={C1} fillOpacity={0.08} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Frame>
    </figure>
  );
}
