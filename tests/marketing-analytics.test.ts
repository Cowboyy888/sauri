/** New vs. returning revenue, channel performance, marketing consent for email audiences (brief §24, §30, §32). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, resetDb, makeVariant, ALL_TIME } from "./helpers";
import { placeOrder, markOrderPaid } from "@/lib/orders/service";
import { getChannelPerformance, getNewVsReturningRevenue } from "@/lib/analytics/marketing";
import { resolveAudience } from "@/lib/marketing/email-campaigns";
import { customers } from "@/lib/db/schema";

const owner = { userId: null, name: "seed", role: "OWNER" as const };

describe("new vs. returning revenue (brief §32)", () => {
  beforeEach(resetDb);

  it("splits revenue by whether the order was the customer's first", async () => {
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000 });
    const first = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "new@example.com", name: "New" }, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, first.id);
    const again = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "new@example.com", name: "New" }, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, again.id);

    const split = await getNewVsReturningRevenue(db, ALL_TIME);
    expect(split.newOrders).toBe(1);
    expect(split.returningOrders).toBe(1);
    expect(split.newRevenueCents).toBe(10_000);
    expect(split.returningRevenueCents).toBe(10_000);
  });
});

describe("channel performance classification (brief §26-27, §30)", () => {
  beforeEach(resetDb);

  it("classifies Google Ads vs Organic Search vs Instagram from UTM data, never fabricating ad spend", async () => {
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000 });
    const ig = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "ig@example.com", name: "IG" }, status: "pending", channel: "WEBSITE",
      acquisition: { source: "INSTAGRAM", details: { utmSource: "instagram", utmMedium: "social" } },
    }, owner);
    await markOrderPaid(db, ig.id);
    const paidGoogle = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "gads@example.com", name: "GAds" }, status: "pending", channel: "WEBSITE",
      acquisition: { source: "GOOGLE", details: { utmSource: "google", utmMedium: "cpc" } },
    }, owner);
    await markOrderPaid(db, paidGoogle.id);

    const channels = await getChannelPerformance(db, ALL_TIME);
    const ig_ = channels.find((c) => c.channel === "Instagram");
    const gAds = channels.find((c) => c.channel === "Google Ads");
    expect(ig_?.orders).toBe(1);
    expect(gAds?.orders).toBe(1);
    // No campaign_costs logged for either — ad spend must be N/A, never a fabricated $0.
    expect(ig_?.adSpendCents).toBeNull();
    expect(gAds?.adSpendCents).toBeNull();
    expect(ig_?.roas).toBeNull();
  });
});

describe("marketing consent respected for email audiences (brief §24)", () => {
  beforeEach(resetDb);

  it("never includes a customer without marketing consent in a segment audience", async () => {
    await db.insert(customers).values([
      { email: "consented@example.com", name: "Consented", marketingOptIn: true },
      { email: "no-consent@example.com", name: "No Consent", marketingOptIn: false },
    ]);
    const audience = await resolveAudience(db, { type: "segment", segmentKey: "new" });
    const emails = audience.map((a) => a.email);
    expect(emails).toContain("consented@example.com");
    expect(emails).not.toContain("no-consent@example.com");
  });

  it("excludes an anonymized customer even if marketing_opt_in was once true", async () => {
    await db.insert(customers).values({ email: "anon@example.com", name: "Anon", marketingOptIn: true, anonymizedAt: new Date() });
    const audience = await resolveAudience(db, { type: "segment", segmentKey: "new" });
    expect(audience.map((a) => a.email)).not.toContain("anon@example.com");
  });
});

afterAll(() => pool.end());
