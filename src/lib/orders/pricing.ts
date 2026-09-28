/**
 * Pure order math. The ONLY place totals, fees and shipping are calculated.
 * No database access here, so it is trivially unit-testable.
 */
import { STORE } from "../config";
import { pct } from "../money";

export type PricedLine = { unitPriceCents: number; unitCostCents: number; quantity: number; productId: string; categoryId: string };
export type AppliedDiscount = {
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  categoryId: string | null;
  productId: string | null;
  maxDiscountCents: number | null;
};
export type ChannelRules = { feePercentBp: number; feeFixedCents: number; shipsOrders: boolean; chargesShipping: boolean };

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  shippingChargedCents: number;
  shippingCostCents: number;
  taxCents: number;
  totalCents: number;
  paymentFeeCents: number;
  cogsCents: number;
};

export function eligibleSubtotal(lines: PricedLine[], d: AppliedDiscount): number {
  return lines
    .filter((l) => (!d.productId || l.productId === d.productId) && (!d.categoryId || l.categoryId === d.categoryId))
    .reduce((a, l) => a + l.unitPriceCents * l.quantity, 0);
}

export function computeTotals(lines: PricedLine[], discount: AppliedDiscount | null, channel: ChannelRules, express: boolean): Totals {
  const subtotalCents = lines.reduce((a, l) => a + l.unitPriceCents * l.quantity, 0);
  const cogsCents = lines.reduce((a, l) => a + l.unitCostCents * l.quantity, 0);
  let discountCents = 0;
  let freeShipping = false;
  if (discount) {
    const elig = eligibleSubtotal(lines, discount);
    if (discount.type === "percent") discountCents = Math.round((elig * discount.value) / 100);
    else if (discount.type === "fixed") discountCents = Math.min(discount.value, elig);
    else freeShipping = true;
    if (discount.maxDiscountCents != null) discountCents = Math.min(discountCents, discount.maxDiscountCents);
  }
  const net = subtotalCents - discountCents;
  let shippingChargedCents = 0;
  if (channel.chargesShipping && subtotalCents > 0) {
    shippingChargedCents = express
      ? STORE.expressShippingCents
      : freeShipping || net >= STORE.freeShippingThresholdCents ? 0 : STORE.standardShippingCents;
  }
  const shippingCostCents = channel.shipsOrders && subtotalCents > 0
    ? (express ? STORE.carrierCostExpressCents : STORE.carrierCostStandardCents)
    : 0;
  const taxCents = pct(net, STORE.taxRateBp);
  const totalCents = net + shippingChargedCents + taxCents;
  const paymentFeeCents = channel.feePercentBp || channel.feeFixedCents
    ? pct(totalCents, channel.feePercentBp) + channel.feeFixedCents
    : 0;
  return { subtotalCents, discountCents, shippingChargedCents, shippingCostCents, taxCents, totalCents, paymentFeeCents, cogsCents };
}
