/**
 * npm run db:reset-data                       DRY RUN: prints what would be deleted, changes nothing.
 * npm run db:reset-data -- --yes --confirm-db=<database name shown by the dry run>
 *
 * Wipes all trading/demo data (products, orders, customers, stock, finance, marketing, purchasing, audit log…)
 * and KEEPS the rows every environment needs: roles, staff users, categories, sales channels, shipping methods,
 * inventory locations, settings, loyalty tiers, expense categories, customer tags. Runs in ONE transaction:
 * either everything is deleted or nothing is. There is no undo — take a backup first (Supabase: Database > Backups).
 */
import pg from "pg";

const KEEP = new Set([
  "roles", "users", "categories", "sales_channels", "shipping_methods", "inventory_locations",
  "settings", "loyalty_tiers", "expense_categories", "customer_tags",
]);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const confirm = args.find((a) => a.startsWith("--confirm-db="))?.split("=")[1];

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const { rows: [who] } = await client.query<{ db: string; host: string | null }>("select current_database() as db, inet_server_addr()::text as host");
    const { rows: tables } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not like '\\_\\_%' and table_name not like 'drizzle%' order by 1",
    );
    const wipe = tables.map((t) => t.table_name).filter((t) => !KEEP.has(t));
    const counts: [string, number][] = [];
    for (const t of wipe) {
      const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from "${t}"`);
      counts.push([t, rows[0]!.n]);
    }
    console.log(`Database: ${who!.db}${who!.host ? ` (${who!.host})` : ""}`);
    console.log("Will DELETE rows from:");
    for (const [t, n] of counts) console.log(`  ${t.padEnd(34)} ${n}`);
    console.log(`Will KEEP: ${[...KEEP].filter((t) => tables.some((x) => x.table_name === t)).join(", ")}`);

    if (!yes) { console.log("\nDry run only. Re-run with --yes --confirm-db=" + who!.db + " to delete."); return; }
    if (confirm !== who!.db) throw new Error(`Refusing: --confirm-db must equal "${who!.db}".`);

    await client.query("begin");
    // One statement so mutually-referencing tables can be truncated together. No CASCADE: if a kept table
    // references a wiped one, Postgres errors and the transaction rolls back instead of silently wiping it.
    await client.query(`truncate table ${wipe.map((t) => `"${t}"`).join(", ")} restart identity`);
    await client.query("commit");
    console.log(`\nDone. ${wipe.length} tables emptied.`);
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
