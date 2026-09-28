/** All amounts are integer cents. These helpers are the only place rounding happens. */
export const pct = (cents: number, basisPoints: number) => Math.round((cents * basisPoints) / 10_000);
export const formatMoney = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
export const toCents = (dollars: number) => Math.round(dollars * 100);
