/** Store rules. Kept in code for now; move to the `settings` table when staff need to edit them. */
export const STORE = {
  currency: "USD",
  timezone: process.env.STORE_TIMEZONE ?? "Asia/Phnom_Penh",
  taxRateBp: 800, // 8.00%, basis points
  freeShippingThresholdCents: 15_000,
  standardShippingCents: 800,
  expressShippingCents: 2_000,
  carrierCostStandardCents: 650,
  carrierCostExpressCents: 1_400,
  largeOrderCents: 50_000,
  maxQuantityPerLine: 10,
} as const;

export const orderNumber = (n: number) => `ORD-${n}`;
