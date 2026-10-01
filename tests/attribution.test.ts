/** UTM parsing, first/last-touch classification, and the per-order attribution snapshot (brief §4-5, §8-9). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { placeOrder, markOrderPaid } from "@/lib/orders/service";
import { classifyAttribution } from "@/lib/storefront/attribution";
import { marketingAttributions, marketingCampaigns } from "@/lib/db/schema";

const owner = { userId: null, name: "seed", role: "OWNER" as const };

describe("attribution classification", () => {
  it("utm_source beats a referrer, and unknown sources become OTHER", () => {
    expect(classifyAttribution({ utmSource: "instagram" }, "sauri.example")).toBe("INSTAGRAM");
    expect(classifyAttribution({ utmSource: "some-ad-network" }, "sauri.example")).toBe("OTHER");
  });
  it("utm_medium = email wins over any source value (brief §22-25 email campaigns)", () => {
    expect(classifyAttribution({ utmSource: "SUMMER2026", utmMedium: "email" }, "sauri.example")).toBe("EMAIL");
  });
  it("an external referrer with no UTM is REFERRAL; no signal at all is DIRECT", () => {
    expect(classifyAttribution({ referrer: "https://someblog.example/post" }, "sauri.example")).toBe("REFERRAL");
    expect(classifyAttribution({}, "sauri.example")).toBe("DIRECT");
    expect(classifyAttribution({ referrer: "https://sauri.example/collections/rings" }, "sauri.example")).toBe("DIRECT");
  });
});

describe("per-order attribution snapshot (brief §4-5, §8)", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("first-touch is captured once and never overwritten; last-touch updates every order", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const first = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "emma@example.com", name: "Emma Chen" }, status: "pending", channel: "WEBSITE",
      acquisition: { source: "INSTAGRAM", details: { utmSource: "instagram", utmMedium: "social", utmCampaign: "SUMMER2026" } },
    }, owner);
    await markOrderPaid(db, first.id);

    const second = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "emma@example.com", name: "Emma Chen" }, status: "pending", channel: "WEBSITE",
      acquisition: { source: "GOOGLE", details: { utmSource: "google", utmMedium: "cpc", utmCampaign: "FALL2026" } },
    }, owner);
    await markOrderPaid(db, second.id);

    const [attr1] = await db.select().from(marketingAttributions).where(eq(marketingAttributions.orderId, first.id));
    const [attr2] = await db.select().from(marketingAttributions).where(eq(marketingAttributions.orderId, second.id));
    // Both orders' first-touch snapshot is the customer's ORIGINAL touch — never overwritten by the second visit.
    expect(attr1!.firstTouchSource).toBe("INSTAGRAM");
    expect(attr2!.firstTouchSource).toBe("INSTAGRAM");
    // But last-touch differs per order — each order freezes what was current *at that moment*.
    expect(attr1!.lastTouchSource).toBe("INSTAGRAM");
    expect(attr2!.lastTouchSource).toBe("GOOGLE");
  });

  it("resolves utm_campaign to a real campaign row at write time, case-insensitively", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await db.insert(marketingCampaigns).values({ name: "Summer Sale", slug: "SUMMER2026", source: "instagram", medium: "social" });
    const order = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "jo@example.com", name: "Jo" }, status: "pending", channel: "WEBSITE",
      acquisition: { source: "INSTAGRAM", details: { utmSource: "instagram", utmMedium: "social", utmCampaign: "summer2026" } },
    }, owner);
    const [attr] = await db.select().from(marketingAttributions).where(eq(marketingAttributions.orderId, order.id));
    const [campaign] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.slug, "SUMMER2026"));
    expect(attr!.lastTouchCampaignId).toBe(campaign!.id);
  });

  it("an order with no acquisition data at all writes no attribution row (never a fabricated one)", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "walkin@example.com", name: "Walk In" }, status: "pending", channel: "WEBSITE" }, owner);
    const [attr] = await db.select().from(marketingAttributions).where(eq(marketingAttributions.orderId, order.id));
    expect(attr).toBeUndefined();
  });
});
