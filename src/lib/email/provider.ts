/**
 * Email provider abstraction (brief §24). No provider is configured yet — the brief explicitly allows
 * this ("if none exists... create a provider abstraction... do not hardcode a provider if one is not
 * already selected"). Swapping in Resend, Postmark, SES, etc. means implementing `send()` here; nothing
 * else in the app imports a provider SDK directly.
 *
 * No `import "server-only"` guard: this is a transitive dependency of `lib/orders/service.ts` (via
 * `lib/loyalty/service.ts`), which `scripts/seed.ts` also imports as a plain Node script (outside Next.js's
 * module graph, where the guard would unconditionally throw regardless of the actual call site).
 */
export type EmailMessage = { to: string; subject: string; text: string };

async function send(message: EmailMessage): Promise<void> {
  // No provider selected: log what would be sent (never the customer's payment details) so the call
  // site and its trigger conditions are exercised and visible in development.
  console.info(`[email:stub] to=${message.to} subject="${message.subject}"`);
}

export const emailProvider = { send };

export function orderConfirmationEmail(o: { orderNumber: string; email: string; totalCents: number }): EmailMessage {
  return { to: o.email, subject: `Order confirmed — ${o.orderNumber}`, text: `Thank you for your order. ${o.orderNumber} is confirmed.` };
}
export function shippingConfirmationEmail(o: { orderNumber: string; email: string; trackingNumber: string; carrier: string | null; trackingUrl?: string | null }): EmailMessage {
  return {
    to: o.email, subject: `Your order has shipped — ${o.orderNumber}`,
    text: `${o.orderNumber} has shipped${o.carrier ? ` via ${o.carrier}` : ""}. Tracking: ${o.trackingNumber}.${o.trackingUrl ? ` Track it: ${o.trackingUrl}` : ""}`,
  };
}
export function deliveryConfirmationEmail(o: { orderNumber: string; email: string }): EmailMessage {
  return { to: o.email, subject: `Delivered — ${o.orderNumber}`, text: `${o.orderNumber} has been delivered. If anything isn't right, you can request a return from your order history within the return window.` };
}
export function returnRequestedEmail(o: { orderNumber: string; email: string }): EmailMessage {
  return { to: o.email, subject: `Return received — ${o.orderNumber}`, text: `We've received your return request for ${o.orderNumber} and will review it shortly.` };
}
export function returnApprovedEmail(o: { orderNumber: string; email: string }): EmailMessage {
  return { to: o.email, subject: `Return approved — ${o.orderNumber}`, text: `Your return for ${o.orderNumber} has been approved. Please ship the item(s) back using the instructions provided.` };
}
export function returnRejectedEmail(o: { orderNumber: string; email: string; reason?: string | null }): EmailMessage {
  return { to: o.email, subject: `Return update — ${o.orderNumber}`, text: `Your return request for ${o.orderNumber} could not be approved.${o.reason ? ` Reason: ${o.reason}` : ""}` };
}
export function refundProcessedEmail(o: { orderNumber: string; email: string; amountCents: number }): EmailMessage {
  return { to: o.email, subject: `Refund processed — ${o.orderNumber}`, text: `A refund of ${(o.amountCents / 100).toFixed(2)} has been processed for ${o.orderNumber}.` };
}

/* ------------------------------------------------------------------- Phase 6 */
export function backInStockEmail(o: { email: string; productName: string; sku: string; slug: string }): EmailMessage {
  return { to: o.email, subject: `Back in stock — ${o.productName}`, text: `${o.productName} (${o.sku}) is back in stock. See it here: /products/${o.slug}` };
}
export function welcomeEmail(o: { email: string; name: string }): EmailMessage {
  return { to: o.email, subject: "Welcome", text: `Welcome, ${o.name}. Thank you for creating an account.` };
}
export function reviewApprovedEmail(o: { email: string; productName: string }): EmailMessage {
  return { to: o.email, subject: "Your review is live", text: `Your review of ${o.productName} has been published. Thank you for sharing it.` };
}
export function loyaltyRewardIssuedEmail(o: { email: string; rewardName: string; code: string }): EmailMessage {
  return { to: o.email, subject: `Reward redeemed — ${o.rewardName}`, text: `You redeemed ${o.rewardName}. Your code: ${o.code}. Apply it at checkout.` };
}

/* ------------------------------------------------------------------- Phase 7 */
export function abandonedCartRecoveryEmail(o: { email: string; name: string; itemCount: number }): EmailMessage {
  return { to: o.email, subject: "You left something in your bag", text: `Hi ${o.name}, you still have ${o.itemCount} ${o.itemCount === 1 ? "item" : "items"} in your bag. Come back and finish checking out.` };
}

/* ------------------------------------------------------------------- Phase 8 */
export function purchaseOrderEmail(o: { email: string; poNumber: string; supplierName: string; totalText: string; expectedDelivery?: string | null }): EmailMessage {
  return {
    to: o.email, subject: `Purchase order ${o.poNumber}`,
    text: `Dear ${o.supplierName},\n\nPlease find attached purchase order ${o.poNumber}, total ${o.totalText}.${o.expectedDelivery ? ` Expected delivery: ${o.expectedDelivery}.` : ""}\n\nThank you.`,
  };
}
