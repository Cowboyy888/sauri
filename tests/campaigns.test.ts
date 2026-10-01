/** Campaign CRUD, status transitions, URL builder, spend logging, and ROAS/ROI (brief §6-7, §28-29, §42, §52). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, resetDb, makeVariant, ALL_TIME } from "./helpers";
import { placeOrder, markOrderPaid } from "@/lib/orders/service";
import { buildCampaignUrl, createCampaign, logCampaignCost, setCampaignStatus } from "@/lib/marketing/campaigns";
import { getCampaignPerformance } from "@/lib/analytics/marketing";
import { ForbiddenError } from "@/lib/errors";

const owner = { userId: null, name: "seed", role: "OWNER" as const };
const admin = { userId: null, name: "admin", role: "ADMIN" as const };
const viewer = { userId: null, name: "viewer", role: "VIEWER" as const };

describe("campaign CRUD and status (brief §6, §42)", () => {
  beforeEach(resetDb);

  it("ADMIN can create and manage campaigns (Phase 7 upgrades ADMIN beyond the OWNER-only discounts area)", async () => {
    const c = await createCampaign(db, admin, { name: "Summer Sale", slug: "summer2026", source: "instagram", medium: "social" });
    expect(c.slug).toBe("SUMMER2026"); // normalized upper-case, matches the utm_campaign matching convention
    expect(c.status).toBe("DRAFT");
  });

  it("VIEWER cannot write, only read", async () => {
    await expect(createCampaign(db, viewer, { name: "X", slug: "X", source: "google", medium: "cpc" })).rejects.toThrow(ForbiddenError);
  });

  it("status transitions follow the brief's state machine; invalid transitions are rejected", async () => {
    const c = await createCampaign(db, owner, { name: "Fall", slug: "FALL2026", source: "google", medium: "cpc" });
    const active = await setCampaignStatus(db, owner, c.id, "ACTIVE");
    expect(active.status).toBe("ACTIVE");
    const paused = await setCampaignStatus(db, owner, c.id, "PAUSED");
    expect(paused.status).toBe("PAUSED");
    await expect(setCampaignStatus(db, owner, c.id, "DRAFT")).rejects.toThrow(/cannot become/);
    const completed = await setCampaignStatus(db, owner, c.id, "COMPLETED");
    expect(completed.status).toBe("COMPLETED");
    await expect(setCampaignStatus(db, owner, c.id, "ACTIVE")).rejects.toThrow(/cannot become/);
  });

  it("a duplicate campaign ID is rejected", async () => {
    await createCampaign(db, owner, { name: "A", slug: "DUPE", source: "google", medium: "cpc" });
    await expect(createCampaign(db, owner, { name: "B", slug: "dupe", source: "google", medium: "cpc" })).rejects.toThrow(/already exists/);
  });
});

describe("campaign URL builder (brief §7)", () => {
  it("appends utm_* params without disturbing an existing query string", () => {
    const url = buildCampaignUrl({ url: "https://sauri.example/collections/rings?ref=abc", source: "Instagram", medium: "Social", campaign: "SUMMER2026", content: "story-1" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("ref")).toBe("abc");
    expect(parsed.searchParams.get("utm_source")).toBe("Instagram");
    expect(parsed.searchParams.get("utm_campaign")).toBe("SUMMER2026");
    expect(parsed.searchParams.get("utm_content")).toBe("story-1");
  });
  it("refuses to build an invalid URL rather than producing a broken one", () => {
    expect(() => buildCampaignUrl({ url: "not a url", source: "a", medium: "b", campaign: "c" })).toThrow();
  });
});

describe("brief §52: campaign ROAS/ROI test", () => {
  beforeEach(resetDb);

  it("SUMMER2026: $500 spend, $2,000 attributed revenue => ROAS 4.0x, ROI 300%", async () => {
    const campaign = await createCampaign(db, owner, { name: "Summer Sale", slug: "SUMMER2026", source: "instagram", medium: "social" });
    await logCampaignCost(db, owner, { campaignId: campaign.id, amountCents: 50_000 }); // $500

    const { variant } = await makeVariant({ stock: 20, priceCents: 200_000 }); // $2,000 per unit, one unit
    const order = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "shopper@example.com", name: "Shopper" }, status: "pending", channel: "WEBSITE",
      acquisition: { source: "INSTAGRAM", details: { utmSource: "instagram", utmMedium: "social", utmCampaign: "SUMMER2026" } },
    }, owner);
    await markOrderPaid(db, order.id);

    const [perf] = await getCampaignPerformance(db, ALL_TIME).then((rows) => rows.filter((r) => r.slug === "SUMMER2026"));
    expect(perf!.revenueCents).toBe(200_000);
    expect(perf!.spendCents).toBe(50_000);
    expect(perf!.roas).toBe(4);
    expect(perf!.roi).toBe(300);
  });

  it("never confuses ROAS with ROI, and reports N/A (null), never 0, when spend is missing", async () => {
    const campaign = await createCampaign(db, owner, { name: "No spend logged", slug: "NOSPEND", source: "google", medium: "organic" });
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000 });
    const order = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "x@example.com", name: "X" }, status: "pending", channel: "WEBSITE",
      acquisition: { source: "GOOGLE", details: { utmSource: "google", utmMedium: "organic", utmCampaign: "NOSPEND" } },
    }, owner);
    await markOrderPaid(db, order.id);
    const [perf] = await getCampaignPerformance(db, ALL_TIME).then((rows) => rows.filter((r) => r.slug === "NOSPEND"));
    expect(perf!.roas).toBeNull();
    expect(perf!.roi).toBeNull();
    expect(perf!.cac).toBeNull();
    void campaign;
  });
});

afterAll(() => pool.end());
