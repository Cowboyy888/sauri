/**
 * Categories and materials: the controlled vocabularies behind product forms. Managed in Admin → Settings.
 * A category or material that products/variants still use can't be deleted (it would orphan them).
 */
import { asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, materials, productVariants, products } from "../db/schema";
import { ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function listCategoriesWithCounts(db: Db) {
  return db.select({ id: categories.id, name: categories.name, slug: categories.slug, skuPrefix: categories.skuPrefix, imageUrl: categories.imageUrl, products: count(products.id) })
    .from(categories).leftJoin(products, eq(products.categoryId, categories.id)).groupBy(categories.id).orderBy(asc(categories.position), asc(categories.name));
}

export async function listMaterialsWithCounts(db: Db) {
  return db.select({ id: materials.id, code: materials.code, name: materials.name, variants: count(productVariants.id) })
    .from(materials).leftJoin(productVariants, eq(productVariants.material, materials.code)).groupBy(materials.id).orderBy(asc(materials.position), asc(materials.name));
}

export async function createCategory(db: Db, actor: Actor, input: { name: string; skuPrefix?: string }) {
  assertCan(actor, "settings:write");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Enter a category name.");
  const s = slug(name).slice(0, 60);
  if (!s) throw new ValidationError("Category name needs letters or numbers.");
  const skuPrefix = (input.skuPrefix?.trim() || name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  if (skuPrefix.length < 2) throw new ValidationError("SKU prefix must be 2–4 letters or numbers.");
  return db.transaction(async (tx) => {
    if ((await tx.select({ id: categories.id }).from(categories).where(sql`${categories.slug} = ${s} or lower(${categories.name}) = ${name.toLowerCase()}`)).length) throw new ValidationError(`A category named “${name}” already exists.`);
    const [maxRow] = await tx.select({ max: sql<number>`coalesce(max(${categories.position}), -1)` }).from(categories);
    const [row] = await tx.insert(categories).values({ slug: s, name, skuPrefix, position: Number(maxRow?.max ?? -1) + 1 }).returning();
    await audit(tx, actor, "Created category", "category", row!.id, undefined, { name, skuPrefix });
    return row!;
  });
}

/** Sets (or clears, with null) the photo shown on the storefront's category tile. */
export async function setCategoryImage(db: Db, actor: Actor, id: string, url: string | null) {
  assertCan(actor, "settings:write");
  if (url !== null && !/^https:\/\/\S{1,480}$/.test(url)) throw new ValidationError("Invalid image address.");
  return db.transaction(async (tx) => {
    const [cat] = await tx.select().from(categories).where(eq(categories.id, id));
    if (!cat) throw new ValidationError("Category not found.");
    await tx.update(categories).set({ imageUrl: url }).where(eq(categories.id, id));
    await audit(tx, actor, url ? "Set category photo" : "Removed category photo", "category", id, { imageUrl: cat.imageUrl }, { imageUrl: url });
  });
}

export async function deleteCategory(db: Db, actor: Actor, id: string) {
  assertCan(actor, "settings:write");
  return db.transaction(async (tx) => {
    const [cat] = await tx.select().from(categories).where(eq(categories.id, id));
    if (!cat) throw new ValidationError("Category not found.");
    const [row] = await tx.select({ n: count() }).from(products).where(eq(products.categoryId, id));
    const n = row?.n ?? 0;
    if (n > 0) throw new ValidationError(`“${cat.name}” still has ${n} product${n === 1 ? "" : "s"}. Move or archive them first.`);
    await tx.delete(categories).where(eq(categories.id, id));
    await audit(tx, actor, "Deleted category", "category", id, { name: cat.name }, undefined);
  });
}

export async function createMaterial(db: Db, actor: Actor, input: { name: string }) {
  assertCan(actor, "settings:write");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Enter a material name.");
  const code = slug(name).slice(0, 24);
  if (!code) throw new ValidationError("Material name needs letters or numbers.");
  return db.transaction(async (tx) => {
    if ((await tx.select({ id: materials.id }).from(materials).where(sql`${materials.code} = ${code} or lower(${materials.name}) = ${name.toLowerCase()}`)).length) throw new ValidationError(`A material named “${name}” already exists.`);
    const [maxRow] = await tx.select({ max: sql<number>`coalesce(max(${materials.position}), -1)` }).from(materials);
    const [row] = await tx.insert(materials).values({ code, name, position: Number(maxRow?.max ?? -1) + 1 }).returning();
    await audit(tx, actor, "Created material", "material", row!.id, undefined, { name, code });
    return row!;
  });
}

export async function deleteMaterial(db: Db, actor: Actor, id: string) {
  assertCan(actor, "settings:write");
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(materials).where(eq(materials.id, id));
    if (!m) throw new ValidationError("Material not found.");
    const [row] = await tx.select({ n: count() }).from(productVariants).where(eq(productVariants.material, m.code));
    const n = row?.n ?? 0;
    if (n > 0) throw new ValidationError(`“${m.name}” is used by ${n} variant${n === 1 ? "" : "s"}. Change those variants first.`);
    await tx.delete(materials).where(eq(materials.id, id));
    await audit(tx, actor, "Deleted material", "material", id, { name: m.name, code: m.code }, undefined);
  });
}
