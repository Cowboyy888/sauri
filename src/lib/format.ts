/** Display formatting shared by server and client components. Money is always integer cents in, text out. */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const money = (cents: number) => usd.format(cents / 100);
/** Whole dollars for KPI cards over $1,000; exact cents otherwise. */
export const moneyKpi = (cents: number) => (Math.abs(cents) >= 100_000 ? usd0.format(cents / 100) : usd.format(cents / 100));
export const moneyAxis = (cents: number) => { const d = cents / 100, a = Math.abs(d); return a >= 1e6 ? `$${(d / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(d / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k` : `$${Math.round(d)}`; };
export const int = (n: number) => n.toLocaleString("en-US");
export const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
export const signedPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;

export const STORE_TZ = process.env.NEXT_PUBLIC_STORE_TIMEZONE ?? process.env.STORE_TIMEZONE ?? "Asia/Phnom_Penh";
export const dateShort = (d: Date | string) => new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
export const dateTime = (d: Date | string) => new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
export const dateTimeFull = (d: Date | string) => new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
export function relTime(d: Date | string) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return dateShort(d);
}
/** Chart bucket labels come from Postgres already in store time ("2026-09-14T00:00"); format without re-zoning. */
export function bucketLabel(b: string, unit: string, long = false) {
  const [y, m, d] = b.slice(0, 10).split("-").map(Number); const hh = Number(b.slice(11, 13));
  const dt = new Date(Date.UTC(y!, m! - 1, d!, hh));
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(dt);
  if (unit === "hour") return long ? `${f({ month: "short", day: "numeric" })}, ${f({ hour: "numeric" })}` : f({ hour: "numeric" });
  if (unit === "month") return f({ month: long ? "long" : "short", year: long ? "numeric" : undefined });
  if (unit === "week") return long ? `Week of ${f({ month: "short", day: "numeric", year: "numeric" })}` : f({ month: "short", day: "numeric" });
  return long ? f({ weekday: "short", month: "short", day: "numeric", year: "numeric" }) : f({ month: "short", day: "numeric" });
}
export const MATERIAL_NAME: Record<string, string> = { yg: "14K Yellow Gold", wg: "14K White Gold", vm: "18K Gold Vermeil", ss: "Sterling Silver" };
export const titleCase = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
