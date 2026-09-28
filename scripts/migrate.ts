import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/lib/db/client";

export async function runMigrations(url: string) {
  const { db, pool } = createDb(url);
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
  console.log("Migrations applied.");
}
