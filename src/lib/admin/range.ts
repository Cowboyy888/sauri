/** Date-range handling shared by every admin page. The range lives in the URL so reports are shareable. */
import type { RangeKey } from "../analytics/service";

export const RANGE_OPTIONS: { key: Exclude<RangeKey, "all" | "custom">; label: string; short: string }[] = [
  { key: "today", label: "Today", short: "Today" },
  { key: "yesterday", label: "Yesterday", short: "Yesterday" },
  { key: "7d", label: "Last 7 days", short: "7D" },
  { key: "30d", label: "Last 30 days", short: "30D" },
  { key: "90d", label: "Last 90 days", short: "90D" },
  { key: "ytd", label: "This year", short: "YTD" },
];
const KEYS = new Set<string>([...RANGE_OPTIONS.map((o) => o.key), "all"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export type ParsedRange = { key: RangeKey; custom?: { from: string; to: string } };

/** ?from=2026-09-01&to=2026-09-28 wins; otherwise ?range=30d; default last 30 days. */
export function parseRange(sp: SearchParams, fallback: RangeKey = "30d"): ParsedRange {
  const from = one(sp.from), to = one(sp.to), range = one(sp.range);
  if (from && to && ISO.test(from) && ISO.test(to) && from <= to) return { key: "custom", custom: { from, to } };
  if (range && KEYS.has(range)) return { key: range as RangeKey };
  return { key: fallback };
}

export function rangeQuery(p: ParsedRange): Record<string, string> {
  return p.key === "custom" && p.custom ? { from: p.custom.from, to: p.custom.to } : { range: p.key };
}

export function rangeLabel(p: ParsedRange): string {
  if (p.key === "custom" && p.custom) return p.custom.from === p.custom.to ? p.custom.from : `${p.custom.from} to ${p.custom.to}`;
  if (p.key === "all") return "All time";
  return RANGE_OPTIONS.find((o) => o.key === p.key)?.label ?? "Last 30 days";
}

export function comparisonLabel(p: ParsedRange): string {
  switch (p.key) {
    case "today": return "vs yesterday, same time";
    case "yesterday": return "vs the day before";
    case "7d": return "vs previous 7 days";
    case "30d": return "vs previous 30 days";
    case "90d": return "vs previous 90 days";
    case "ytd": return "vs the equivalent earlier period";
    default: return "vs previous period";
  }
}

/** Percentage change, or null when there is nothing to compare against (never divide by zero). */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function pageParams(sp: SearchParams, pageSize = 25) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
