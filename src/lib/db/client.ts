import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; every service function accepts either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { sauriPool?: Pool; sauriDb?: Db };

/** Supabase's pooler presents a certificate chain Node doesn't trust by default in some environments
 *  (including Vercel's build/runtime); `pg-connection-string` otherwise turns a `sslmode=require` query
 *  param into full chain verification and the connection is refused. The traffic is still encrypted —
 *  only strict CA-chain verification is relaxed, the standard mitigation Supabase's own docs recommend for
 *  `pg`/node-postgres. `sslmode` is stripped from the URL and replaced with an explicit `ssl` option so
 *  there's no ambiguity between the two ways `pg` can receive SSL config. Local Postgres (dev/test) never
 *  sets `sslmode`, so this leaves that connection exactly as before (no SSL negotiated). */
export function createDb(url: string): { db: Db; pool: Pool } {
  const parsed = new URL(url);
  const useRelaxedSsl = parsed.searchParams.get("sslmode") === "require";
  parsed.searchParams.delete("sslmode");
  const pool = new Pool({ connectionString: parsed.toString(), max: 10, ssl: useRelaxedSsl ? { rejectUnauthorized: false } : undefined });
  return { db: drizzle(pool, { schema }), pool };
}

/** Shared connection for the app (reused across hot reloads in dev). */
export function getDb(): Db {
  if (!globalForDb.sauriDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
    const { db, pool } = createDb(url);
    globalForDb.sauriPool = pool;
    globalForDb.sauriDb = db;
  }
  return globalForDb.sauriDb;
}

export { schema };
