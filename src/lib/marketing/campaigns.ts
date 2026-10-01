/**
 * Marketing campaigns (brief §6-7, §42-43). A campaign's `slug` IS the exact `utm_campaign` value used to
 * match traffic and orders to it — see docs/CAMPAIGNS.md. CRUD and status transitions only; campaign
 * *analytics* (funnel, revenue, ROAS/ROI/CAC) live in lib/analytics/marketing.ts, which reads these rows
 * but never writes them.
 */
import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { campaignCosts, marketingCampaigns } from "../db/schema";
import { ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { rows } from "../admin/sql";

export type CampaignRow = typeof marketingCampaigns.$inferSelect;
export type CampaignStatus = CampaignRow["status"];

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

const slugify = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");

export type NewCampaign = { name: string; slug: string; source: string; medium: string; budgetCents?: number | null; description?: string; startDate?: Date | null; endDate?: Date | null };

export async function createCampaign(db: Db, actor: Actor, input: NewCampaign): Promise<CampaignRow> {
  assertCan(actor, "marketing:write");
  const slug = slugify(input.slug);
  if (!/^[A-Z0-9_-]{2,40}$/.test(slug)) throw new ValidationError("Use 2 to 40 letters, numbers, - or _ for the campaign ID.");
  if (!input.name.trim()) throw new ValidationError("Enter a campaign name.");
  if (!input.source.trim() || !input.medium.trim()) throw new ValidationError("Enter a source and medium.");
  if (input.budgetCents != null && input.budgetCents < 0) throw new ValidationError("Budget can't be negative.");
  if (input.startDate && input.endDate && input.startDate > input.endDate) throw new ValidationError("The end date must be after the start date.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(marketingCampaigns).values({
      name: input.name.trim(), slug, source: input.source.trim(), medium: input.medium.trim(),
      budgetCents: input.budgetCents ?? null, description: input.description ?? "", startDate: input.startDate ?? null, endDate: input.endDate ?? null,
      createdByUserId: actor.userId,
    }).onConflictDoNothing().returning();
    if (!row) throw new ValidationError("A campaign with that ID already exists.");
    await audit(tx, actor, "Created campaign", "marketing_campaign", row.slug, undefined, { name: row.name, source: row.source, medium: row.medium });
    return row;
  });
}

export type CampaignPatch = Partial<Omit<NewCampaign, "slug">>;
export async function updateCampaign(db: Db, actor: Actor, id: string, patch: CampaignPatch): Promise<CampaignRow> {
  assertCan(actor, "marketing:write");
  if (patch.budgetCents != null && patch.budgetCents < 0) throw new ValidationError("Budget can't be negative.");
  const start = patch.startDate, end = patch.endDate;
  if (start && end && start > end) throw new ValidationError("The end date must be after the start date.");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
    if (!before) throw new ValidationError("Campaign not found.");
    const [row] = await tx.update(marketingCampaigns).set({ ...patch, name: patch.name?.trim() }).where(eq(marketingCampaigns.id, id)).returning();
    await audit(tx, actor, "Updated campaign", "marketing_campaign", before.slug, before, row);
    return row!;
  });
}

export async function setCampaignStatus(db: Db, actor: Actor, id: string, next: CampaignStatus): Promise<CampaignRow> {
  assertCan(actor, "marketing:write");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
    if (!c) throw new ValidationError("Campaign not found.");
    if (!CAMPAIGN_TRANSITIONS[c.status].includes(next)) throw new ValidationError(`A campaign that is ${c.status} cannot become ${next}.`);
    const [row] = await tx.update(marketingCampaigns).set({ status: next }).where(eq(marketingCampaigns.id, id)).returning();
    await audit(tx, actor, "Changed campaign status", "marketing_campaign", c.slug, { status: c.status }, { status: next });
    return row!;
  });
}

export async function listCampaigns(db: DbOrTx): Promise<CampaignRow[]> {
  return db.select().from(marketingCampaigns).orderBy(sql`${marketingCampaigns.createdAt} desc`);
}
export async function getCampaign(db: DbOrTx, id: string): Promise<CampaignRow | null> {
  const [row] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  return row ?? null;
}

/** Matches a raw utm_campaign value (from a cookie, event or order) to a campaign row, case-insensitively.
 *  Used at write time (marketing_attributions, marketing_events) so every later query is a plain join. */
export async function resolveCampaignId(tx: DbOrTx, utmCampaign: string | null | undefined): Promise<string | null> {
  if (!utmCampaign?.trim()) return null;
  const [row] = await tx.select({ id: marketingCampaigns.id }).from(marketingCampaigns).where(sql`lower(${marketingCampaigns.slug}) = ${utmCampaign.trim().toLowerCase()}`);
  return row?.id ?? null;
}

/* --------------------------------------------------------------------- costs */
export type NewCost = { campaignId: string; amountCents: number; incurredAt?: Date; note?: string };
export async function logCampaignCost(db: Db, actor: Actor, input: NewCost) {
  assertCan(actor, "marketing:write");
  if (input.amountCents <= 0) throw new ValidationError("Enter an amount above zero.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ slug: marketingCampaigns.slug }).from(marketingCampaigns).where(eq(marketingCampaigns.id, input.campaignId));
    if (!c) throw new ValidationError("Campaign not found.");
    const [row] = await tx.insert(campaignCosts).values({
      campaignId: input.campaignId, amountCents: input.amountCents, incurredAt: input.incurredAt ?? new Date(), note: input.note ?? null, createdByUserId: actor.userId,
    }).returning();
    await audit(tx, actor, "Logged campaign spend", "marketing_campaign", c.slug, undefined, { amountCents: input.amountCents, note: input.note });
    return row!;
  });
}

export async function deleteCampaignCost(db: Db, actor: Actor, id: string) {
  assertCan(actor, "marketing:write");
  await db.delete(campaignCosts).where(eq(campaignCosts.id, id));
}

export async function listCampaignCosts(db: DbOrTx, campaignId: string) {
  return db.select().from(campaignCosts).where(eq(campaignCosts.campaignId, campaignId)).orderBy(sql`${campaignCosts.incurredAt} desc`);
}

export async function getCampaignActualSpendCents(db: DbOrTx, campaignId: string): Promise<number> {
  const [row] = await rows<{ total: string | null }>(db, sql`select sum(amount_cents) as total from campaign_costs where campaign_id = ${campaignId}`);
  return Number(row?.total ?? 0);
}

/* --------------------------------------------------------------------- URL builder (brief §7) */
export type UtmParams = { url: string; source: string; medium: string; campaign: string; term?: string; content?: string };
/** Pure function — appends utm_* params to a destination URL without disturbing whatever query string (or
 *  fragment) it already has. Throws rather than silently producing a broken URL (brief: "do not create
 *  invalid URLs"). */
export function buildCampaignUrl(input: UtmParams): string {
  let url: URL;
  try { url = new URL(input.url); } catch { throw new ValidationError("Enter a valid destination URL, including https://."); }
  if (!input.source.trim() || !input.medium.trim() || !input.campaign.trim()) throw new ValidationError("Source, medium and campaign are required.");
  url.searchParams.set("utm_source", input.source.trim());
  url.searchParams.set("utm_medium", input.medium.trim());
  url.searchParams.set("utm_campaign", input.campaign.trim());
  if (input.term?.trim()) url.searchParams.set("utm_term", input.term.trim());
  if (input.content?.trim()) url.searchParams.set("utm_content", input.content.trim());
  return url.toString();
}
