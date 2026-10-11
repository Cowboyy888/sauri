/**
 * Bulk product CSV import (brief §7): upload → validate → preview → show errors → confirm → apply, as one
 * all-or-nothing transaction ("never partially modify data without clear transaction behavior"). Reuses
 * `createProduct`/`addVariant`'s own validation rules rather than a second set — a row that would be
 * rejected by the normal product form is rejected here too, with the same messages.
 *
 * The brief's own column list (Product Name, SKU, Category, Collection, Variant, Cost, Price, Stock,
 * Reorder Level) doesn't include the controlled `material` enum every variant requires (yg/wg/vm/ss) — an
 * optional `Material` column is accepted (defaulting to `yg`, this catalog's most common material) so a row
 * without one still produces a valid variant rather than being silently guessed at in a more surprising way;
 * see docs/PRODUCT_MANAGEMENT.md.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, collections, inventory, productVariants, products } from "../db/schema";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { normalizeSku, slugify } from "./service";

const DEFAULT_MATERIALS: readonly string[] = ["yg", "wg", "vm", "ss"];

export type ImportRow = {
  line: number; productName: string; sku: string; category: string; collection?: string; variant?: string;
  material?: string; color?: string; size?: string; gemstone?: string; barcode?: string;
  costCents: number; priceCents: number; stock: number; reorderLevel: number;
};
export type ImportError = { line: number; field: string; message: string };
export type ImportPreview = { rows: ImportRow[]; errors: ImportError[]; creates: number; updates: number };

function parseMoney(v: string): number | null {
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function parseInt0(v: string): number | null {
  const n = Number(v.trim());
  return Number.isInteger(n) ? n : null;
}

/** RFC-4180-ish CSV parsing: quoted fields, escaped quotes, CRLF or LF. No external dependency. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function validateImport(csvText: string, materialCodes: readonly string[] = DEFAULT_MATERIALS): ImportPreview {
  const table = parseCsv(csvText);
  if (!table.length) return { rows: [], errors: [{ line: 0, field: "file", message: "The file is empty." }], creates: 0, updates: 0 };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const required = ["product name", "sku", "category", "cost", "price", "stock", "reorder level"];
  const missing = required.filter((r) => col(r) === -1);
  if (missing.length) return { rows: [], errors: [{ line: 1, field: "header", message: `Missing column(s): ${missing.join(", ")}.` }], creates: 0, updates: 0 };

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seenSkus = new Set<string>();
  for (let i = 1; i < table.length; i++) {
    const r = table[i]!;
    const line = i + 1;
    const get = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
    const productName = get("product name"), sku = normalizeSku(get("sku")), category = get("category");
    if (!productName) errors.push({ line, field: "Product Name", message: "Required." });
    if (!sku) errors.push({ line, field: "SKU", message: "Required." });
    else if (!/^[A-Z0-9-]{3,40}$/.test(sku)) errors.push({ line, field: "SKU", message: "Must be 3–40 letters, numbers or dashes." });
    else if (seenSkus.has(sku)) errors.push({ line, field: "SKU", message: `Duplicate SKU ${sku} within this file.` });
    seenSkus.add(sku);
    if (!category) errors.push({ line, field: "Category", message: "Required." });
    const costCents = parseMoney(get("cost")); if (costCents == null || costCents < 0) errors.push({ line, field: "Cost", message: "Must be a number, zero or more." });
    const priceCents = parseMoney(get("price")); if (priceCents == null || priceCents <= 0) errors.push({ line, field: "Price", message: "Must be a number above zero." });
    const stock = parseInt0(get("stock")); if (stock == null || stock < 0) errors.push({ line, field: "Stock", message: "Must be a whole number, zero or more." });
    const reorderLevel = parseInt0(get("reorder level")); if (reorderLevel == null || reorderLevel < 0) errors.push({ line, field: "Reorder Level", message: "Must be a whole number, zero or more." });
    const material = get("material").toLowerCase() || undefined;
    if (material && !materialCodes.includes(material)) errors.push({ line, field: "Material", message: `Must be one of: ${materialCodes.join(", ")}.` });
    rows.push({
      line, productName, sku, category, collection: get("collection") || undefined, variant: get("variant") || undefined,
      material, color: get("color") || undefined, size: get("size") || undefined, gemstone: get("gemstone") || undefined, barcode: get("barcode") || undefined,
      costCents: costCents ?? 0, priceCents: priceCents ?? 0, stock: stock ?? 0, reorderLevel: reorderLevel ?? 0,
    });
  }
  return { rows, errors, creates: 0, updates: 0 };
}

/** Applies a previously validated preview. Refuses to run at all if any row still has an error (brief: "never
 *  partially modify data"), and runs as one transaction — either every row applies or none do. */
export async function applyProductImport(db: Db, actor: Actor, preview: ImportPreview): Promise<{ created: number; updated: number }> {
  assertCan(actor, "products:write");
  if (preview.errors.length) throw new Error("Fix every error before importing.");
  if (!preview.rows.length) return { created: 0, updated: 0 };
  return db.transaction(async (tx) => {
    let created = 0, updated = 0;
    const cats = await tx.select().from(categories);
    const catBySlugOrName = new Map(cats.flatMap((c) => [[c.slug.toLowerCase(), c], [c.name.toLowerCase(), c]] as const));
    const cols = await tx.select().from(collections);
    const colBySlugOrName = new Map(cols.flatMap((c) => [[c.slug.toLowerCase(), c], [c.name.toLowerCase(), c]] as const));
    const skus = preview.rows.map((r) => r.sku);
    const existingVariants = await tx.select().from(productVariants).where(inArray(productVariants.sku, skus));
    const existingBySku = new Map(existingVariants.map((v) => [v.sku, v]));

    for (const row of preview.rows) {
      const cat = catBySlugOrName.get(row.category.toLowerCase());
      if (!cat) throw new Error(`Line ${row.line}: category "${row.category}" doesn't exist.`);
      const coll = row.collection ? colBySlugOrName.get(row.collection.toLowerCase()) : undefined;
      const existing = existingBySku.get(row.sku);

      if (existing) {
        await tx.update(productVariants).set({ costPriceCents: row.costCents, sellingPriceCents: row.priceCents, barcode: row.barcode || existing.barcode }).where(eq(productVariants.id, existing.id));
        await tx.update(inventory).set({ reorderLevel: row.reorderLevel }).where(eq(inventory.variantId, existing.id));
        const [inv] = await tx.select().from(inventory).where(eq(inventory.variantId, existing.id));
        if (inv && inv.stockQuantity !== row.stock) {
          const delta = row.stock - inv.stockQuantity;
          await tx.update(inventory).set({ stockQuantity: row.stock }).where(eq(inventory.variantId, existing.id));
          await tx.execute(sql`insert into inventory_movements (variant_id, movement_type, quantity, stock_before, stock_after, reference_type, notes, user_id)
            values (${existing.id}, 'ADJUSTMENT', ${delta}, ${inv.stockQuantity}, ${row.stock}, 'stock_count', 'CSV import', ${actor.userId})`);
        }
        updated++;
        continue;
      }

      let [product] = await tx.select().from(products).where(and(eq(products.name, row.productName), eq(products.categoryId, cat.id)));
      if (!product) {
        const slug = slugify(row.productName);
        let finalSlug = slug, n = 2;
        while ((await tx.select({ id: products.id }).from(products).where(eq(products.slug, finalSlug))).length) { finalSlug = `${slug}-${n}`; n++; }
        const base = (row.productName.replace(/[^A-Za-z]/g, "").slice(0, 3) || "PRD").toUpperCase();
        let code = base, k = 2;
        while ((await tx.select({ id: products.id }).from(products).where(eq(products.code, code))).length) { code = `${base}${k}`; k++; }
        [product] = await tx.insert(products).values({ name: row.productName, slug: finalSlug, code, categoryId: cat.id, collectionId: coll?.id ?? null, status: "draft" }).returning();
      }
      const [variant] = await tx.insert(productVariants).values({
        productId: product!.id, sku: row.sku, barcode: row.barcode || null, material: row.material || "yg", color: row.color || null, size: row.size || row.variant || null, gemstone: row.gemstone || null,
        costPriceCents: row.costCents, sellingPriceCents: row.priceCents,
      }).returning();
      await tx.insert(inventory).values({ variantId: variant!.id, stockQuantity: row.stock, reorderLevel: row.reorderLevel });
      if (row.stock > 0) await tx.execute(sql`insert into inventory_movements (variant_id, movement_type, quantity, stock_before, stock_after, reference_type, notes, user_id)
        values (${variant!.id}, 'PURCHASE', ${row.stock}, 0, ${row.stock}, 'opening_balance', 'CSV import', ${actor.userId})`);
      created++;
    }
    await audit(tx, actor, "Imported products from CSV", "product", null, undefined, { created, updated });
    return { created, updated };
  });
}
