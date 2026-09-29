import "server-only";
import Stripe from "stripe";

/** A single instance, reused across hot reloads in dev (same pattern as lib/db/client.ts). Always call
 *  methods on this instance — never the deprecated module-level `Stripe.setApiKey` pattern. */
const globalForStripe = globalThis as unknown as { sauriStripe?: Stripe };

export function getStripe(): Stripe {
  if (!globalForStripe.sauriStripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
    globalForStripe.sauriStripe = new Stripe(key);
  }
  return globalForStripe.sauriStripe;
}
