/**
 * Catalog mutations for the admin. Every function checks the caller's permission and writes the audit log.
 * Stock is NOT edited here: new variants start at 0 and are stocked through lib/inventory (restock).
 */
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, materials, inventory, inventoryMovements, orderItems, productImages, productPriceHistory, productVariants, products, settings, users } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { type Actor, type Role, assertCan } from "../auth/permissions";
import { audit } from "../audit";

export const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

function checkPrices(v: { sellingPriceCents?: number; costPriceCents?: number; compareAtPriceCents?: number | null }) {
  if (v.sellingPriceCents != null && !(Number.isInteger(v.sellingPriceCents) && v.sellingPriceCents > 0)) throw new ValidationError("Selling price must be above zero.");
  if (v.costPriceCents != null && !(Number.isInteger(v.costPriceCents) && v.costPriceCents >= 0)) throw new ValidationError("Cost price must be zero or more.");
  if (v.compareAtPriceCents != null && v.sellingPriceCents != null && v.compareAtPriceCents <= v.sellingPriceCents) throw new ValidationError("Compare-at price must be higher than the selling price.");
}
function checkImageUrl(url: string) {
  if (!/^(https:\/\/|\/products\/)[^\s"'<>]+$/.test(url)) throw new ValidationError("Image URL must start with https:// (e.g. Supabase Storage) or /products/.");
}

export type NewProductInput = {
  name: string; slug?: string; shortDescription?: string; description?: string; categoryId: string; collectionId?: string | null;
  status: "draft" | "active" | "archived"; featured?: boolean; bestSeller?: boolean; newArrival?: boolean;
  seoTitle?: string; seoDescription?: string; canonicalUrl?: string; brand?: string; careInstructions?: string; tags?: string[];
  material: string; color?: string | null; size?: string | null; gemstone?: string | null; style?: string | null;
  sku?: string | null; barcode?: string | null; costPriceCents: number; sellingPriceCents: number; compareAtPriceCents?: number | null; weightMg?: number;
  reorderLevel?: number; imageUrls?: string[];
};

/** Tidies a typed SKU: upper-case, spaces/underscores/slashes/dots become dashes, anything else is dropped, dashes collapsed. */
export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_./\\]+/g, "-").replace(/[^A-Z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}

/** Short SKU token for a material code: short codes (yg, ss) as-is, longer slugs by initials (14k-rose-gold → RG). */
const materialSkuPart = (code: string) => {
  if (code.length <= 4) return code;
  const words = code.split("-").filter((w) => w && !/^\d+k?$/.test(w));
  const initials = words.map((w) => w[0]).join("");
  return initials.length >= 2 ? initials : (words.join("") || code).slice(0, 3);
};

/** PREFIX-CODE-MATERIAL[-SIZE][-GEM], e.g. RNG-NEW-YG-6 (same shape as the seeded SKUs); a numeric suffix is added until unique. */
async function generateSku(tx: Pick<Db, "select">, parts: { prefix: string; code: string; material: string; size?: string | null; gemstone?: string | null }) {
  const base = normalizeSku([parts.prefix, parts.code, materialSkuPart(parts.material), parts.size?.replace(/"/g, "IN"), parts.gemstone?.slice(0, 2)].filter(Boolean).join("-")).slice(0, 36);
  let sku = base;
  for (let i = 2; (await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku))).length; i++) sku = `${base}-${i}`;
  return sku;
}

export async function createProduct(db: Db, actor: Actor, input: NewProductInput) {
  assertCan(actor, "products:write");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Enter a product name.");
  const slug = slugify(input.slug?.trim() || name);
  if (!slug) throw new ValidationError("Enter a valid URL slug.");
  const typedSku = normalizeSku(input.sku ?? "");
  if (typedSku && !/^[A-Z0-9-]{3,40}$/.test(typedSku)) throw new ValidationError("SKU must be 3–40 characters long, using letters, numbers or dashes (e.g. RNG-NEW-YG-6). Leave it blank to auto-generate.");
  checkPrices(input);
  input.imageUrls?.forEach(checkImageUrl);
  return db.transaction(async (tx) => {
    if ((await tx.select({ id: products.id }).from(products).where(eq(products.slug, slug))).length) throw new ValidationError("Another product already uses that URL slug.");
    if (typedSku && (await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, typedSku))).length) throw new ValidationError(`SKU ${typedSku} is already in use.`);
    const [cat] = await tx.select().from(categories).where(eq(categories.id, input.categoryId));
    if (!cat) throw new ValidationError("Choose a category.");
    if (!(await tx.select({ id: materials.id }).from(materials).where(eq(materials.code, input.material))).length) throw new ValidationError("Choose a material.");
    // Product code (the middle of generated SKUs): letters from the name, made unique.
    const base = (name.replace(/[^A-Za-z]/g, "").slice(0, 3) || "PRD").toUpperCase();
    let code = base;
    for (let i = 2; (await tx.select({ id: products.id }).from(products).where(eq(products.code, code))).length; i++) code = `${base}${i}`;
    const sku = typedSku || await generateSku(tx, { prefix: cat.skuPrefix, code, material: input.material, size: input.size, gemstone: input.gemstone });
    const [p] = await tx.insert(products).values({
      name, slug, code, shortDescription: input.shortDescription?.trim() ?? "", description: input.description?.trim() ?? "", categoryId: cat.id, collectionId: input.collectionId || null,
      status: input.status, featured: !!input.featured, bestSeller: !!input.bestSeller, newArrival: !!input.newArrival,
      seoTitle: input.seoTitle?.trim() || `${name} | SAURI`, seoDescription: input.seoDescription?.trim() || input.shortDescription?.trim() || null,
      canonicalUrl: input.canonicalUrl?.trim() || null, brand: input.brand?.trim() || null, careInstructions: input.careInstructions?.trim() || null, tags: input.tags ?? [],
    }).returning();
    const [v] = await tx.insert(productVariants).values({
      productId: p!.id, sku, barcode: input.barcode?.trim() || null, material: input.material, color: input.color || null, size: input.size || null, gemstone: input.gemstone || null, style: input.style || null,
      costPriceCents: input.costPriceCents, sellingPriceCents: input.sellingPriceCents, compareAtPriceCents: input.compareAtPriceCents ?? null, weightMg: input.weightMg ?? 0,
    }).returning();
    await tx.insert(inventory).values({ variantId: v!.id, stockQuantity: 0, reorderLevel: input.reorderLevel ?? 5 });
    await tx.insert(productPriceHistory).values({ variantId: v!.id, sellingPriceCents: input.sellingPriceCents, compareAtPriceCents: input.compareAtPriceCents ?? null, changedByUserId: actor.userId });
    if (input.imageUrls?.length) await tx.insert(productImages).values(input.imageUrls.map((url, i) => ({ productId: p!.id, variantId: i === 0 ? v!.id : null, url, alt: name, position: i })));
    await audit(tx, actor, "Created product", "product", p!.id, undefined, { name, sku, sellingPriceCents: input.sellingPriceCents, costPriceCents: input.costPriceCents, status: input.status });
    return p!;
  });
}

export type ProductPatch = Partial<Pick<NewProductInput, "name" | "slug" | "shortDescription" | "description" | "categoryId" | "collectionId" | "status" | "featured" | "bestSeller" | "newArrival" | "seoTitle" | "seoDescription" | "canonicalUrl" | "brand" | "careInstructions" | "tags">>;
export async function updateProduct(db: Db, actor: Actor, id: string, patch: ProductPatch) {
  assertCan(actor, "products:write");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
    if (!before) throw new NotFoundError("Product not found.");
    const next: Record<string, unknown> = { ...patch };
    if (patch.name !== undefined) { next.name = patch.name.trim(); if (!next.name) throw new ValidationError("Enter a product name."); }
    if (patch.slug !== undefined) {
      next.slug = slugify(patch.slug);
      if (!next.slug) throw new ValidationError("Enter a valid URL slug.");
      if ((await tx.select({ id: products.id }).from(products).where(and(eq(products.slug, next.slug as string), ne(products.id, id)))).length) throw new ValidationError("Another product already uses that URL slug.");
    }
    if (patch.collectionId === "") next.collectionId = null;
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify(v)));
    if (!Object.keys(changed).length) return before;
    const [after] = await tx.update(products).set(changed).where(eq(products.id, id)).returning();
    const old = Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]]));
    const action = "status" in changed ? (changed.status === "archived" ? "Archived product" : "Changed product status") : "Updated product";
    await audit(tx, actor, action, "product", id, old, changed);
    return after!;
  });
}

export type VariantPatch = { sellingPriceCents?: number; costPriceCents?: number; compareAtPriceCents?: number | null; barcode?: string | null; weightMg?: number; status?: "active" | "inactive"; style?: string | null };
export async function updateVariant(db: Db, actor: Actor, variantId: string, patch: VariantPatch) {
  assertCan(actor, "products:write");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId)).for("update");
    if (!before) throw new NotFoundError("Variant not found.");
    const merged = { ...before, ...patch };
    checkPrices(merged);
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && (before as Record<string, unknown>)[k] !== v));
    if (!Object.keys(changed).length) return before;
    await tx.update(productVariants).set(changed).where(eq(productVariants.id, variantId));
    const old = Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]]));
    const action = "sellingPriceCents" in changed ? "Changed product price" : "costPriceCents" in changed ? "Changed cost price" : "Updated variant";
    await audit(tx, actor, action, "product_variant", before.sku, old, changed);
    // Phase 8 (brief §38): a permanent, append-only price history — never overwritten, one write path.
    if ("sellingPriceCents" in changed || "compareAtPriceCents" in changed) {
      await tx.insert(productPriceHistory).values({
        variantId, sellingPriceCents: merged.sellingPriceCents, compareAtPriceCents: merged.compareAtPriceCents ?? null, changedByUserId: actor.userId,
      });
    }
  });
}

export async function addVariant(db: Db, actor: Actor, productId: string, v: { sku?: string | null; material: string; color?: string | null; size?: string | null; gemstone?: string | null; style?: string | null; barcode?: string | null; sellingPriceCents: number; costPriceCents: number; compareAtPriceCents?: number | null; weightMg?: number; reorderLevel?: number }) {
  assertCan(actor, "products:write");
  const typedSku = normalizeSku(v.sku ?? "");
  if (typedSku && !/^[A-Z0-9-]{3,40}$/.test(typedSku)) throw new ValidationError("SKU must be 3–40 characters long, using letters, numbers or dashes (e.g. RNG-NEW-YG-6). Leave it blank to auto-generate.");
  checkPrices(v);
  return db.transaction(async (tx) => {
    if (!(await tx.select({ id: materials.id }).from(materials).where(eq(materials.code, v.material))).length) throw new ValidationError("Choose a material.");
    const [prod] = await tx.select({ code: products.code, prefix: categories.skuPrefix }).from(products).innerJoin(categories, eq(categories.id, products.categoryId)).where(eq(products.id, productId));
    if (!prod) throw new NotFoundError("Product not found.");
    if (typedSku && (await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, typedSku))).length) throw new ValidationError(`SKU ${typedSku} is already in use.`);
    const sku = typedSku || await generateSku(tx, { prefix: prod.prefix, code: prod.code, material: v.material, size: v.size, gemstone: v.gemstone });
    const [row] = await tx.insert(productVariants).values({ productId, sku, material: v.material, color: v.color || null, size: v.size || null, gemstone: v.gemstone || null, barcode: v.barcode || null, sellingPriceCents: v.sellingPriceCents, costPriceCents: v.costPriceCents, compareAtPriceCents: v.compareAtPriceCents ?? null, weightMg: v.weightMg ?? 0 }).returning();
    await tx.insert(inventory).values({ variantId: row!.id, stockQuantity: 0, reorderLevel: v.reorderLevel ?? 5 });
    await tx.insert(productPriceHistory).values({ variantId: row!.id, sellingPriceCents: v.sellingPriceCents, compareAtPriceCents: v.compareAtPriceCents ?? null, changedByUserId: actor.userId });
    await audit(tx, actor, "Added variant", "product_variant", sku, undefined, { productId, sellingPriceCents: v.sellingPriceCents, costPriceCents: v.costPriceCents });
    return row!;
  });
}

/** A new DRAFT copy with new SKUs (suffix -C, -C2, …), zero stock, the same images. */
export async function duplicateProduct(db: Db, actor: Actor, id: string) {
  assertCan(actor, "products:write");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, id));
    if (!p) throw new NotFoundError("Product not found.");
    const vs = await tx.select().from(productVariants).where(eq(productVariants.productId, id));
    const imgs = await tx.select().from(productImages).where(eq(productImages.productId, id));
    let n = 1, slug = `${p.slug}-copy`, code = `${p.code}C`;
    while ((await tx.select({ id: products.id }).from(products).where(sql`${products.slug} = ${slug} or ${products.code} = ${code}`)).length) { n++; slug = `${p.slug}-copy-${n}`; code = `${p.code}C${n}`; }
    const { id: _omit, createdAt: _c, updatedAt: _u, ...rest } = p;
    void _omit; void _c; void _u;
    const [copy] = await tx.insert(products).values({ ...rest, name: `${p.name} (copy)`, slug, code, status: "draft", featured: false }).returning();
    const idMap = new Map<string, string>();
    for (const v of vs) {
      let sku = `${v.sku}-C${n > 1 ? n : ""}`;
      for (let k = 2; (await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku))).length; k++) sku = `${v.sku}-C${k}`;
      const { id: vid, createdAt: _vc, updatedAt: _vu, productId: _p, ...vr } = v;
      void _vc; void _vu; void _p;
      const [nv] = await tx.insert(productVariants).values({ ...vr, productId: copy!.id, sku, barcode: null }).returning();
      idMap.set(vid, nv!.id);
      const [inv] = await tx.select().from(inventory).where(eq(inventory.variantId, vid));
      await tx.insert(inventory).values({ variantId: nv!.id, stockQuantity: 0, reorderLevel: inv?.reorderLevel ?? 5 });
    }
    if (imgs.length) await tx.insert(productImages).values(imgs.map((i) => ({ productId: copy!.id, variantId: i.variantId ? idMap.get(i.variantId) ?? null : null, url: i.url, alt: i.alt, position: i.position })));
    await audit(tx, actor, "Duplicated product", "product", copy!.id, { from: p.name }, { name: copy!.name, variants: vs.length });
    return copy!;
  });
}

export async function setProductArchived(db: Db, actor: Actor, id: string, archived: boolean) {
  return updateProduct(db, actor, id, { status: archived ? "archived" : "active" });
}

/** Permanent delete is only allowed for products that were never stocked or sold. Everything else is archived. */
export async function deleteProduct(db: Db, actor: Actor, id: string) {
  assertCan(actor, "products:write");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, id)).for("update");
    if (!p) throw new NotFoundError("Product not found.");
    const vids = (await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, id))).map((v) => v.id);
    const [sold] = await tx.select({ c: count() }).from(orderItems).where(eq(orderItems.productId, id));
    const [moved] = vids.length ? await tx.select({ c: count() }).from(inventoryMovements).where(inArray(inventoryMovements.variantId, vids)) : [{ c: 0 }];
    if ((sold?.c ?? 0) > 0) throw new ValidationError(`${p.name} appears on past orders, so it can't be deleted. Archive it instead.`);
    if ((moved?.c ?? 0) > 0) throw new ValidationError(`${p.name} has stock history, so it can't be deleted. Archive it instead.`);
    await tx.delete(products).where(eq(products.id, id));
    await audit(tx, actor, "Deleted product", "product", id, { name: p.name, slug: p.slug }, undefined);
  });
}

/* ---------------------------------------------------------- bulk actions (Phase 8 brief §6) */
export async function bulkSetProductStatus(db: Db, actor: Actor, ids: string[], status: "active" | "archived") {
  assertCan(actor, "products:write");
  if (!ids.length) return;
  return db.transaction(async (tx) => {
    await tx.update(products).set({ status }).where(inArray(products.id, ids));
    await audit(tx, actor, status === "archived" ? "Bulk-archived products" : "Bulk-activated products", "product", null, undefined, { count: ids.length, status });
  });
}
export async function bulkSetCategory(db: Db, actor: Actor, ids: string[], categoryId: string) {
  assertCan(actor, "products:write");
  if (!ids.length) return;
  return db.transaction(async (tx) => {
    if (!(await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId))).length) throw new ValidationError("Choose a category.");
    await tx.update(products).set({ categoryId }).where(inArray(products.id, ids));
    await audit(tx, actor, "Bulk-updated category", "product", null, undefined, { count: ids.length, categoryId });
  });
}
export async function bulkSetCollection(db: Db, actor: Actor, ids: string[], collectionId: string | null) {
  assertCan(actor, "products:write");
  if (!ids.length) return;
  await db.transaction(async (tx) => {
    await tx.update(products).set({ collectionId }).where(inArray(products.id, ids));
    await audit(tx, actor, "Bulk-updated collection", "product", null, undefined, { count: ids.length, collectionId });
  });
}
/** Sets the reorder level for every variant of the given products — never a price change (brief §6 says
 *  never allow a dangerous bulk price change without confirmation; this phase doesn't add bulk pricing at all). */
export async function bulkSetReorderLevel(db: Db, actor: Actor, productIds: string[], level: number) {
  assertCan(actor, "products:write");
  if (!Number.isInteger(level) || level < 0) throw new ValidationError("Reorder level must be zero or more.");
  if (!productIds.length) return;
  await db.transaction(async (tx) => {
    const variantIds = (await tx.select({ id: productVariants.id }).from(productVariants).where(inArray(productVariants.productId, productIds))).map((v) => v.id);
    if (variantIds.length) await tx.update(inventory).set({ reorderLevel: level }).where(inArray(inventory.variantId, variantIds));
    await audit(tx, actor, "Bulk-updated reorder level", "product", null, undefined, { productCount: productIds.length, level });
  });
}

export async function addProductImage(db: Db, actor: Actor, productId: string, url: string, alt: string) {
  assertCan(actor, "products:write");
  checkImageUrl(url.trim());
  const [{ c }] = await db.select({ c: count() }).from(productImages).where(eq(productImages.productId, productId)) as [{ c: number }];
  await db.insert(productImages).values({ productId, url: url.trim(), alt: alt.trim(), position: c });
  await audit(db, actor, "Added product image", "product", productId, undefined, { url: url.trim() });
}
export async function removeProductImage(db: Db, actor: Actor, imageId: string) {
  assertCan(actor, "products:write");
  const [img] = await db.delete(productImages).where(eq(productImages.id, imageId)).returning();
  if (img) await audit(db, actor, "Removed product image", "product", img.productId, { url: img.url }, undefined);
}


export async function updateContent(db: Db, actor: Actor, v: { announce: string; heroTitle: string; heroLede: string }) {
  assertCan(actor, "content:write");
  const next = { announce: v.announce.trim().slice(0, 120), heroTitle: v.heroTitle.trim().slice(0, 60) || "Jewelry for every moment", heroLede: v.heroLede.trim().slice(0, 300) };
  const [before] = await db.select().from(settings).where(eq(settings.key, "content"));
  await db.insert(settings).values({ key: "content", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Edited content", "settings", "content", before?.value ?? null, next);
}

/** OWNER only. The last active owner cannot demote or deactivate themself out of the system. */
export async function updateStaff(db: Db, actor: Actor, userId: string, patch: { role?: Role; active?: boolean }) {
  assertCan(actor, "staff:write");
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new NotFoundError("Staff member not found.");
    const losingOwner = u.role === "OWNER" && ((patch.role && patch.role !== "OWNER") || patch.active === false);
    if (losingOwner) {
      const [{ c }] = await tx.select({ c: count() }).from(users).where(and(eq(users.role, "OWNER"), eq(users.active, true))) as [{ c: number }];
      if (c <= 1) throw new ValidationError("There must always be at least one active owner.");
    }
    await tx.update(users).set(patch).where(eq(users.id, userId));
    if (patch.role && patch.role !== u.role) await audit(tx, actor, "Changed user role", "user", u.email, { role: u.role }, { role: patch.role });
    if (patch.active !== undefined && patch.active !== u.active) await audit(tx, actor, patch.active ? "Reactivated user" : "Deactivated user", "user", u.email, { active: u.active }, { active: patch.active });
  });
}
export async function addStaff(db: Db, actor: Actor, v: { email: string; name: string; role: Role }) {
  assertCan(actor, "staff:write");
  const email = v.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  const [row] = await db.insert(users).values({ email, name: v.name.trim() || email, role: v.role }).onConflictDoNothing().returning();
  if (!row) throw new ValidationError("A staff member with that email already exists.");
  await audit(db, actor, "Added staff member", "user", email, undefined, { role: v.role });
  return row;
}
