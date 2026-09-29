import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listAllRewards, listAllTiers, loyaltyKpis, getLoyaltySettings } from "@/lib/loyalty/service";
import { int, money } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/states";
import { Button } from "@/components/ui/button";
import { LoyaltySettingsForm, RewardDialog, TierDialog } from "@/components/admin/loyalty-forms";

export const metadata = { title: "Loyalty" };
export const dynamic = "force-dynamic";

export default async function LoyaltyAdminPage() {
  const g = await guard("loyalty:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const db = getDb();
  const [kpis, tiers, rewards, settings] = await Promise.all([loyaltyKpis(db), listAllTiers(db), listAllRewards(db), getLoyaltySettings(db)]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Loyalty" description="Points, tiers and rewards — rewards redeem into the existing discount system, never a second one (brief §29)." />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Loyalty figures">
        <KPICard label="Loyalty members" value={int(kpis.members)} change={null} comparison="" />
        <KPICard label="Points issued" value={int(kpis.pointsIssued)} change={null} comparison="" note="Lifetime" />
        <KPICard label="Points redeemed" value={int(kpis.pointsRedeemed)} change={null} comparison="" note="Lifetime" />
        <KPICard label="Points outstanding" value={int(kpis.pointsOutstanding)} change={null} comparison="" note="Current liability" />
      </section>

      {g.can("loyalty:write") && <Card><CardHeader title="Earning rule" /><CardBody><LoyaltySettingsForm enabled={settings.enabled} pointsPerDollar={settings.pointsPerDollar} /></CardBody></Card>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tiers" description="Derived live from lifetime net spend — never stored per customer." actions={g.can("loyalty:write") && <TierDialog trigger={<Button size="sm" variant="primary">New tier</Button>} />} />
          <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Loyalty tiers</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Tier</th><th className="px-3 font-medium">Min. spend</th><th className="px-3 font-medium">Benefits</th><th className="px-3 font-medium">Status</th><th className="pr-4" /></tr></thead>
            <tbody>{tiers.map((t) => {
              const b = t.benefits as { bonusPointsMultiplier?: number; earlyAccess?: boolean; freeShipping?: boolean };
              const bits = [b.bonusPointsMultiplier && b.bonusPointsMultiplier > 1 ? `${b.bonusPointsMultiplier}× points` : null, b.earlyAccess ? "early access" : null, b.freeShipping ? "free shipping" : null].filter(Boolean);
              return (
                <tr key={t.id} className="border-b border-line-soft last:border-0">
                  <td className="py-2.5 pl-4 font-medium">{t.name}</td><td className="px-3">{money(t.minSpendCents)}</td>
                  <td className="px-3 text-muted">{bits.length ? bits.join(", ") : "—"}</td><td className="px-3"><StatusBadge status={t.active ? "active" : "inactive"} /></td>
                  <td className="px-3 pr-4">{g.can("loyalty:write") && <TierDialog tier={t} trigger={<Button size="sm">Edit</Button>} />}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
        <Card>
          <CardHeader title="Rewards" actions={g.can("loyalty:write") && <RewardDialog trigger={<Button size="sm" variant="primary">New reward</Button>} />} />
          {!rewards.length ? <EmptyState title="No rewards yet" /> : (
            <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Loyalty rewards</caption>
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Reward</th><th className="num px-3 font-medium">Points</th><th className="px-3 font-medium">Status</th><th className="pr-4" /></tr></thead>
              <tbody>{rewards.map((r) => (
                <tr key={r.id} className="border-b border-line-soft last:border-0">
                  <td className="py-2.5 pl-4"><p className="font-medium">{r.name}</p>{r.description && <p className="text-xs text-muted">{r.description}</p>}</td>
                  <td className="num px-3">{int(r.pointsCost)}</td><td className="px-3"><StatusBadge status={r.active ? "active" : "inactive"} /></td>
                  <td className="px-3 pr-4">{g.can("loyalty:write") && <RewardDialog reward={r} trigger={<Button size="sm">Edit</Button>} />}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Top loyalty customers" />
        {!kpis.topCustomers.length ? <EmptyState title="No loyalty members yet" /> : (
          <ul className="divide-y divide-line-soft text-[13px]">{kpis.topCustomers.map((c) => (
            <li key={c.customerId} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <Link href={`/admin/customers/${c.customerId}`} className="font-medium text-accent hover:underline">{c.name}</Link>
              <span className="num font-medium">{int(c.pointsBalance)} pts</span>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
