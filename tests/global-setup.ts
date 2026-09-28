import { Client } from "pg";
import { runMigrations } from "../scripts/migrate";

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/sauri_test";

/** Fresh schema for every `npm test` run. Refuses to touch anything that is not a *_test database. */
export default async function setup() {
  if (!/_test(\?|$)/.test(TEST_URL)) throw new Error(`Refusing to wipe ${TEST_URL}: test database name must end in _test`);
  const c = new Client({ connectionString: TEST_URL });
  await c.connect();
  await c.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await c.end();
  await runMigrations(TEST_URL);
}
