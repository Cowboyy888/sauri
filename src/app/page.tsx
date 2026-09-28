import { getDb } from "@/lib/db/client";
import { listActiveProducts } from "@/lib/catalog/queries";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function Home() {
  const items = await listActiveProducts(getDb());
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-xs uppercase tracking-[0.3em] text-champagne">SAURI</p>
      <h1 className="mt-3 font-display text-5xl">Jewelry for every moment</h1>
      <p className="mt-4 max-w-xl text-ink/70">Phase 1 foundation: this list is read live from Postgres. The full storefront design is ported in phase 2.</p>
      <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((p) => (
          <li key={p.id} className="border-t border-ink/15 pt-4">
            <p className="text-xs uppercase tracking-widest text-ink/50">{p.category}{p.badge ? ` · ${p.badge}` : ""}</p>
            <p className="mt-1 font-display text-xl">{p.name}</p>
            <p className="mt-1 text-sm">From {formatMoney(p.fromPriceCents)}</p>
            <p className={`mt-1 text-xs ${p.available > 0 ? "text-emerald-700" : "text-red-700"}`}>{p.available > 0 ? "In stock" : "Sold out"}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
