import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { getLoyaltySettings, getLoyaltySummary, listCustomerRewards } from "@/lib/loyalty/service";
import { formatMoney } from "@/lib/money";
import { dateShort } from "@/lib/format";
import { RedeemRewardButton } from "@/components/storefront/account/redeem-reward-button";

export const metadata: Metadata = { title: "Loyalty" };
export const dynamic = "force-dynamic";

export default async function LoyaltyPage() {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) redirect("/account?next=/account/loyalty");
  const cfg = await getLoyaltySettings(db);
  if (!cfg.enabled) return <div><h1 className="font-display text-3xl">Loyalty</h1><p className="mt-4 font-sans text-sm text-ink/60">Our loyalty program isn&rsquo;t active right now.</p></div>;

  const [summary, rewards] = await Promise.all([getLoyaltySummary(db, customer.id), listCustomerRewards(db)]);

  return (
    <div>
      <h1 className="font-display text-3xl">Loyalty</h1>
      <div className="mt-8 grid gap-10 sm:grid-cols-2">
        <section>
          <p className="font-display text-5xl">{summary.pointsBalance.toLocaleString()}</p>
          <p className="font-sans text-xs uppercase tracking-widest text-ink/50">points</p>
          <p className="mt-4 font-display text-2xl">{summary.tier?.name ?? "Member"}</p>
          {summary.nextTier ? <p className="mt-1 font-sans text-sm text-ink/60">{formatMoney(summary.centsToNextTier)} remaining to {summary.nextTier.name}</p> : <p className="mt-1 font-sans text-sm text-ink/60">Top tier reached</p>}
        </section>
        <section>
          <h2 className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Available rewards</h2>
          <ul className="mt-3 grid gap-2">
            {rewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border border-ink/10 p-3 font-sans text-sm">
                <span><span className="block">{r.name}</span><span className="text-xs text-ink/50">{r.pointsCost.toLocaleString()} points</span></span>
                <RedeemRewardButton rewardId={r.id} pointsCost={r.pointsCost} available={summary.pointsBalance} />
              </li>
            ))}
            {!rewards.length && <p className="font-sans text-sm text-ink/50">No rewards available yet.</p>}
          </ul>
        </section>
      </div>
      <section className="mt-10">
        <h2 className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Transaction history</h2>
        <ul className="mt-3 divide-y divide-ink/10 font-sans text-sm">
          {summary.transactions.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
              <span>{t.reason ?? t.type}<span className="ml-2 text-xs text-ink/40">{dateShort(t.createdAt)}</span></span>
              <span className={t.points > 0 ? "text-ink" : "text-error"}>{t.points > 0 ? "+" : ""}{t.points}</span>
            </li>
          ))}
          {!summary.transactions.length && <p className="py-4 text-ink/50">No activity yet.</p>}
        </ul>
      </section>
    </div>
  );
}
