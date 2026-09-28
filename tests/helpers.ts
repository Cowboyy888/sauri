import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { categories, inventory, productVariants, products, users } from "@/lib/db/schema";
import { upsertReferenceData } from "@/lib/db/reference-data";
import type { Actor, Role } from "@/lib/auth/permissions";

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/sauri_test";
process.env.DATABASE_URL = TEST_URL; // route handlers call getDb(); point them at the test database
export const { db, pool } = createDb(TEST_URL);

export async function resetDb() {
  const r = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = (r.rows as { tablename: string }[]).map((x) => `"${x.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  await db.execute(sql`alter sequence order_number_seq restart with 10001`);
  await upsertReferenceData(db);
}

export async function makeStaff(role: Role, opts: { email?: string; authUserId?: string | null; active?: boolean } = {}): Promise<Actor> {
  const [u] = await db.insert(users).values({ email: opts.email ?? `${role.toLowerCase()}@sauri.test`, name: role.toLowerCase(), role, authUserId: opts.authUserId ?? null, active: opts.active ?? true }).returning();
  return { userId: u!.id, name: u!.name, role };
}

/** One product with one variant. Defaults are the brief's business-test numbers. */
export async function makeVariant(o: { name?: string; stock?: number; costCents?: number; priceCents?: number; reorder?: number; code?: string; category?: string } = {}, db_: Db = db) {
  const [cat] = await db_.select().from(categories).where(sql`${categories.slug} = ${o.category ?? "rings"}`);
  const code = o.code ?? "AUR";
  const [p] = await db_.insert(products).values({ slug: `test-${code.toLowerCase()}`, code, name: o.name ?? "Aurora Ring", categoryId: cat!.id, status: "active" }).returning();
  const [v] = await db_.insert(productVariants).values({ productId: p!.id, sku: `RNG-${code}-YG-6`, material: "yg", size: "6", sellingPriceCents: o.priceCents ?? 10_000, costPriceCents: o.costCents ?? 5_000 }).returning();
  await db_.insert(inventory).values({ variantId: v!.id, stockQuantity: o.stock ?? 100, reorderLevel: o.reorder ?? 5 });
  return { product: p!, variant: v!, categoryId: cat!.id };
}

export const buyer = { email: "ana@example.com", name: "Ana Reyes" };
export const ALL_TIME = { from: new Date("2000-01-01"), to: new Date("2100-01-01") };
