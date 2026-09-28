/**
 * npm run db:seed        reference data + the 16-piece catalog + discounts + staff (safe for production setup)
 * npm run db:seed:demo   the above, plus ~120 days of demo orders placed through the real order service
 *
 * Demo data is for development only. With --demo the script refuses to run unless the
 * database is empty of orders, so it can never be mixed into real records.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import {
  categories, collections, discounts, inventory, inventoryMovements, orders, productCollections, productVariants, products, reviews, suppliers, users,
} from "../src/lib/db/schema";
import { upsertReferenceData } from "../src/lib/db/reference-data";
import { placeOrder, updateOrderStatus } from "../src/lib/orders/service";
import type { Actor } from "../src/lib/auth/permissions";

type Cat = { materials: Record<string, { name: string; f: number }>; products: Array<{ id: string; slug: string; name: string; cat: string; price: number; cmp?: number; mats: string[]; size: { type: string; opts: string[] } | null; gems: string[]; badge?: string; isBest?: boolean; isNew?: boolean; short: string; desc: string; details: string[]; occ: string[] }> };
const catalog: Cat = JSON.parse(readFileSync(new URL("./data/catalog.json", import.meta.url), "utf8"));
const COST_RATIO: Record<string, number> = { yg: 0.44, wg: 0.45, vm: 0.33, ss: 0.29 };
const demo = process.argv.includes("--demo");

function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = mulberry(20260927);
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)]!;
function wpick<T>(e: [T, number][]): T { const tot = e.reduce((a, x) => a + x[1], 0); let r = R() * tot; for (const x of e) { r -= x[1]; if (r <= 0) return x[0]; } return e[0]![0]; }
function basePrice(p: Cat["products"][number], m: string) {
  const f0 = catalog.materials[p.mats[0]!]!.f, f = catalog.materials[m]!.f;
  if (f === f0) return p.price * 100;
  return (Math.floor((p.price * f) / f0 / 10) * 10 + 8) * 100;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(url);
  await upsertReferenceData(db);

  const [ordersCount] = await db.select({ n: sql<number>`count(*)::int` }).from(orders);
  if (demo && ordersCount!.n > 0) throw new Error("Refusing to add demo orders: this database already has orders.");

  const staff = [
    { email: "owner@sauri.example", name: "Owner", role: "OWNER" as const },
    { email: "dara@sauri.example", name: "Dara", role: "ADMIN" as const },
    { email: "sokha@sauri.example", name: "Sokha", role: "SALES" as const },
    { email: "vanna@sauri.example", name: "Vanna", role: "INVENTORY" as const },
    { email: "accounts@sauri.example", name: "Accountant", role: "VIEWER" as const },
  ];
  await db.insert(users).values(staff).onConflictDoNothing();
  const [owner] = await db.select().from(users).where(eq(users.email, "owner@sauri.example"));
  const ownerActor: Actor = { userId: owner!.id, name: owner!.name, role: "OWNER" };

  await db.insert(suppliers).values(["Aurum Atelier, Bangkok", "Linden Castings", "Perla Freshwater Co.", "Northgate Findings"].map((name) => ({ name }))).onConflictDoNothing();
  await db.insert(collections).values([
    { slug: "new", name: "New arrivals" }, { slug: "best-sellers", name: "Best sellers" }, { slug: "gifts", name: "Gifts", description: "Under $250" }, { slug: "sale", name: "Sale" },
  ]).onConflictDoNothing();
  const cols = Object.fromEntries((await db.select().from(collections)).map((c) => [c.slug, c.id]));
  const cats = Object.fromEntries((await db.select().from(categories)).map((c) => [c.slug, c]));

  let variantCount = 0;
  for (const p of catalog.products) {
    const code = p.id.slice(0, 3).toUpperCase();
    const [row] = await db.insert(products).values({
      slug: p.slug, code, name: p.name, shortDescription: p.short, description: p.desc, categoryId: cats[p.cat]!.id, status: "active",
      badge: p.badge ?? null, compareAtCents: p.cmp ? p.cmp * 100 : null, isNew: !!p.isNew, isBestSeller: !!p.isBest,
      seoTitle: `${p.name} | SAURI`, seoDescription: p.short, tags: p.occ, details: p.details,
    }).onConflictDoNothing().returning();
    if (!row) continue; // already seeded
    const inCols = [p.isNew && "new", p.isBest && "best-sellers", p.price <= 250 && "gifts", p.cmp && "sale"].filter(Boolean) as string[];
    if (inCols.length) await db.insert(productCollections).values(inCols.map((c) => ({ productId: row.id, collectionId: cols[c]! })));
    const sizes = p.size ? p.size.opts : [null];
    const gems = p.gems.length ? p.gems : [null];
    for (const m of p.mats) for (const s of sizes) for (const g of gems) {
      const price = basePrice(p, m);
      const sku = [cats[p.cat]!.skuPrefix, code, m.toUpperCase(), s ? s.replace('"', "IN") : null, g ? g.slice(0, 2).toUpperCase() : null].filter(Boolean).join("-");
      const [v] = await db.insert(productVariants).values({
        productId: row.id, sku, material: m, size: s, gemstone: g, priceCents: price, costCents: Math.round(price * COST_RATIO[m]!),
        weightMg: p.cat === "bracelets" ? 6_500 : p.cat === "necklaces" ? 4_200 : p.cat === "rings" ? 2_800 : 1_900,
        barcode: "8" + String(Math.abs([...sku].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))).padStart(12, "0").slice(0, 12),
      }).returning();
      await db.insert(inventory).values({ variantId: v!.id, onHand: 0, reorderLevel: p.cat === "rings" ? 3 : 5 });
      variantCount++;
    }
    // A handful of published reviews per product so the storefront has content.
    await db.insert(reviews).values([
      { productId: row.id, rating: 5, title: "Have not taken it off", body: "Wear it every day. Still looks new.", authorName: "Hana K.", status: "published" as const },
      { productId: row.id, rating: 4, title: "Beautiful, runs slightly small", body: "Lovely finish. Size up if between sizes.", authorName: "Claire D.", status: "published" as const },
    ]);
  }

  const now = Date.now(), day = 86_400_000;
  await db.insert(discounts).values([
    { code: "SAURI10", type: "percent", value: 10, startsAt: new Date(now - 400 * day) },
    { code: "WELCOME15", type: "percent", value: 15, minSubtotalCents: 10_000, maxDiscountCents: 6_000, perCustomerLimit: 1, startsAt: new Date(now - 400 * day) },
    { code: "FREESHIP", type: "free_shipping", value: 0, minSubtotalCents: 6_000, usageLimit: 500 },
    { code: "RINGS20", type: "percent", value: 20, categoryId: cats.rings!.id, maxDiscountCents: 10_000, endsAt: new Date(now + 14 * day), usageLimit: 200, perCustomerLimit: 1 },
  ]).onConflictDoNothing();

  // Opening stock: one PURCHASE movement per variant so the ledger starts from zero and always reconciles.
  const variants = await db.select().from(productVariants);
  const opening = demo ? new Date(now - 125 * day) : new Date();
  for (const v of variants) {
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, v.id));
    if (!inv || inv.onHand > 0) continue;
    const qty = demo ? 20 + Math.floor(R() * 40) : 10 + Math.floor(R() * 30);
    await db.transaction(async (tx) => {
      await tx.update(inventory).set({ onHand: qty }).where(eq(inventory.variantId, v.id));
      await tx.insert(inventoryMovements).values({ variantId: v.id, type: "PURCHASE", quantity: qty, before: 0, after: qty, unitCostCents: v.costCents, reference: "OPENING", notes: "Opening stock", userId: owner!.id, createdAt: opening });
    });
  }
  console.log(`Catalog: ${catalog.products.length} products, ${variantCount} new variants.`);

  if (demo) {
    const FN = ["Sophea", "Dara", "Maya", "Claire", "Nita", "Jules", "Amara", "Lin", "Priya", "Elise", "Rosa", "Mei", "Hana", "Chloe", "Ava", "Leah", "Nora", "Iris", "Kanha", "Bopha", "Lucy", "Zoe", "Emma", "Grace", "Anh", "Yuki", "Nadia", "Ines", "Tara", "Ella"];
    const LN = ["Kim", "Lim", "Chan", "Sok", "Nguyen", "Tan", "Martin", "Dubois", "Rossi", "Park", "Lee", "Wong", "Heng", "Patel", "Garcia", "Silva", "Keo", "Meas", "Costa", "Ito"];
    const people: { email: string; name: string }[] = [];
    const weights: [Cat["products"][number], number][] = catalog.products.map((p) => [p, p.isBest ? 3 : 1]);
    const bySlug = new Map((await db.select().from(products)).map((p) => [p.slug, p.id]));
    const variantsByProduct = new Map<string, string[]>();
    for (const v of variants) variantsByProduct.set(v.productId, [...(variantsByProduct.get(v.productId) ?? []), v.id]);
    const channels: [string, number][] = [["web", 55], ["instagram", 12], ["facebook", 6], ["tiktok", 9], ["store", 10], ["wholesale", 2], ["manual", 4], ["other", 2]];
    let placed = 0, skipped = 0;
    for (let d = 120; d >= 0; d--) {
      const dayStart = new Date(now - d * day); dayStart.setHours(0, 0, 0, 0);
      const n = Math.max(0, Math.round(3 + 4 * (1 - d / 120) + (R() - 0.5) * 4));
      for (let k = 0; k < n; k++) {
        const t = d === 0 ? new Date(dayStart.getTime() + R() * (now - dayStart.getTime())) : new Date(dayStart.getTime() + (8 + R() * 14) * 3_600_000);
        let person: { email: string; name: string };
        if (people.length > 15 && R() < 0.35) person = pick(people);
        else { const f = pick(FN), l = pick(LN); person = { name: `${f} ${l}`, email: `${f}.${l}${people.length}@example.com`.toLowerCase() }; people.push(person); }
        const p = wpick(weights);
        const variantId = pick(variantsByProduct.get(bySlug.get(p.slug)!)!);
        const channel = wpick(channels);
        try {
          const o = await placeOrder(db, {
            lines: [{ variantId, quantity: channel === "wholesale" ? 3 : R() < 0.1 ? 2 : 1 }], channel, customer: person, status: "paid", placedAt: t,
            discountCode: R() < 0.1 ? "SAURI10" : null, paymentProvider: channel === "web" ? "stripe" : "manual",
          });
          placed++;
          const age = (now - t.getTime()) / day;
          if (age > 3 && R() < 0.025) await updateOrderStatus(db, ownerActor, o.id, "refunded", { reason: "Demo refund" });
          else if (age > 1) {
            await db.update(orders).set({ status: age > 7 ? "delivered" : age > 3 ? "shipped" : "processing" }).where(eq(orders.id, o.id));
          }
        } catch { skipped++; } // sold out: a real customer would have seen "sold out" too
      }
    }
    console.log(`Demo history: ${placed} orders placed through the order service (${skipped} skipped as sold out).`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
