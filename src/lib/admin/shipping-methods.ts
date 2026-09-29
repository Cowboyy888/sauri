/** Admin CRUD for shipping methods (brief §15) — the only place these rows are written; the storefront
 *  (`lib/storefront/shipping.ts`) only ever reads them. */
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shippingMethods } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";

export async function listAllShippingMethods(db: Db) {
  return db.select().from(shippingMethods).orderBy(asc(shippingMethods.position), asc(shippingMethods.name));
}

export type ShippingMethodInput = {
  name: string; description?: string; priceCents: number; estimatedMinDays: number; estimatedMaxDays: number;
  waivableAboveThreshold?: boolean; carrierCostCents?: number; countryCode?: string | null; region?: string | null;
  minOrderCents?: number | null; maxOrderCents?: number | null; active?: boolean; position?: number;
};

function validate(v: ShippingMethodInput) {
  if (!v.name.trim()) throw new ValidationError("Enter a name.");
  if (v.estimatedMinDays > v.estimatedMaxDays) throw new ValidationError("Minimum delivery days can't exceed the maximum.");
  if (v.minOrderCents != null && v.maxOrderCents != null && v.minOrderCents > v.maxOrderCents) throw new ValidationError("Minimum order can't exceed the maximum.");
}

export async function createShippingMethod(db: Db, actor: Actor, input: ShippingMethodInput) {
  assertCan(actor, "settings:write");
  validate(input);
  const [m] = await db.insert(shippingMethods).values({
    name: input.name.trim(), description: input.description?.trim() ?? "", priceCents: input.priceCents,
    estimatedMinDays: input.estimatedMinDays, estimatedMaxDays: input.estimatedMaxDays,
    waivableAboveThreshold: input.waivableAboveThreshold ?? false, carrierCostCents: input.carrierCostCents ?? 0,
    countryCode: input.countryCode || null, region: input.region || null, minOrderCents: input.minOrderCents ?? null, maxOrderCents: input.maxOrderCents ?? null,
    active: input.active ?? true,
  }).returning();
  await audit(db, actor, "Created shipping method", "shipping_method", m!.id, undefined, input);
  return m!;
}

export async function updateShippingMethod(db: Db, actor: Actor, id: string, input: ShippingMethodInput) {
  assertCan(actor, "settings:write");
  validate(input);
  const [before] = await db.select().from(shippingMethods).where(eq(shippingMethods.id, id));
  if (!before) throw new NotFoundError("Shipping method not found.");
  await db.update(shippingMethods).set({
    name: input.name.trim(), description: input.description?.trim() ?? "", priceCents: input.priceCents,
    estimatedMinDays: input.estimatedMinDays, estimatedMaxDays: input.estimatedMaxDays,
    waivableAboveThreshold: input.waivableAboveThreshold ?? false, carrierCostCents: input.carrierCostCents ?? 0,
    countryCode: input.countryCode || null, region: input.region || null, minOrderCents: input.minOrderCents ?? null, maxOrderCents: input.maxOrderCents ?? null,
    active: input.active ?? before.active,
  }).where(eq(shippingMethods.id, id));
  await audit(db, actor, "Updated shipping method", "shipping_method", id, before, input);
}

export async function setShippingMethodActive(db: Db, actor: Actor, id: string, active: boolean) {
  assertCan(actor, "settings:write");
  await db.update(shippingMethods).set({ active }).where(eq(shippingMethods.id, id));
  await audit(db, actor, active ? "Activated shipping method" : "Deactivated shipping method", "shipping_method", id);
}
