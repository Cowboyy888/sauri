import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; every service function accepts either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { sauriPool?: Pool; sauriDb?: Db };

export function createDb(url: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 10 });
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
