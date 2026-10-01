import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listCampaigns } from "@/lib/marketing/campaigns";
import { listPromotions } from "@/lib/marketing/promotions";
import { listEmailCampaigns } from "@/lib/marketing/email-campaigns";
import { guard } from "@/lib/admin/guard";
import { safe } from "@/lib/admin/safe";
import { one, type SearchParams } from "@/lib/admin/range";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody } from "@/components/ui/card";
import { ErrorState } from "@/components/admin/states";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Marketing calendar" };

type CalEvent = { date: string; label: string; kind: "campaign" | "promotion" | "email"; href: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function MarketingCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("marketing:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb();
  const view = one(sp.view) === "week" ? "week" : "month";
  const monthParam = one(sp.month); // YYYY-MM
  const today = new Date();
  const anchor = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01T00:00:00Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const res = await safe("calendar", async () => {
    const [campaigns, promotions, emails] = await Promise.all([listCampaigns(db), listPromotions(db), listEmailCampaigns(db)]);
    const events: CalEvent[] = [];
    for (const c of campaigns) {
      if (c.startDate) events.push({ date: iso(new Date(c.startDate)), label: `Campaign starts: ${c.name}`, kind: "campaign", href: "/admin/marketing/campaigns" });
      if (c.endDate) events.push({ date: iso(new Date(c.endDate)), label: `Campaign ends: ${c.name}`, kind: "campaign", href: "/admin/marketing/campaigns" });
    }
    for (const p of promotions) {
      events.push({ date: iso(new Date(p.startsAt)), label: `Promotion starts: ${p.code}`, kind: "promotion", href: "/admin/marketing/promotions" });
      if (p.endsAt) events.push({ date: iso(new Date(p.endsAt)), label: `Promotion ends: ${p.code}`, kind: "promotion", href: "/admin/marketing/promotions" });
    }
    for (const e of emails) {
      const at = e.sentAt ?? e.scheduledAt;
      if (at) events.push({ date: iso(new Date(at)), label: `Email${e.sentAt ? " sent" : " scheduled"}: ${e.name}`, kind: "email", href: "/admin/marketing/email" });
    }
    return events;
  }, one(sp.fail));

  const days: Date[] = [];
  if (view === "month") {
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const startWeekday = first.getUTCDay(); // 0=Sun
    const gridStart = new Date(first); gridStart.setUTCDate(first.getUTCDate() - startWeekday);
    for (let i = 0; i < 42; i++) { const d = new Date(gridStart); d.setUTCDate(gridStart.getUTCDate() + i); days.push(d); }
  } else {
    const weekday = anchor.getUTCDay();
    const start = new Date(anchor); start.setUTCDate(anchor.getUTCDate() - weekday);
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); days.push(d); }
  }
  const monthLabel = anchor.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const prevMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1));
  const nextMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  const KIND_TONE = { campaign: "bg-accent-soft text-accent", promotion: "bg-[#e9f3ec] text-pos", email: "bg-[#e8eef7] text-info" } as const;

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Marketing calendar" description="Campaigns, promotions and email sends — click an event to open it.">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Link href={`/admin/marketing/calendar?view=month&month=${iso(prevMonth).slice(0, 7)}`} className="text-accent hover:underline">← Prev</Link>
          <span className="font-medium">{monthLabel}</span>
          <Link href={`/admin/marketing/calendar?view=month&month=${iso(nextMonth).slice(0, 7)}`} className="text-accent hover:underline">Next →</Link>
          <Link href="/admin/marketing/calendar?view=month" className={cn("ml-3", view === "month" && "font-semibold")}>Month</Link>
          <Link href="/admin/marketing/calendar?view=week" className={cn(view === "week" && "font-semibold")}>Week</Link>
        </div>
      </PageHeader>
      <Card>
        <CardBody>
          {!res.ok ? <ErrorState message="Unable to load the calendar." /> : (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line bg-line-soft text-[12.5px]">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="bg-canvas px-2 py-1.5 text-center font-medium text-muted">{d}</div>)}
              {days.map((d) => {
                const key = iso(d);
                const inMonth = view === "week" || d.getUTCMonth() === anchor.getUTCMonth();
                const dayEvents = res.data.filter((e) => e.date === key);
                return (
                  <div key={key} className={cn("min-h-[84px] bg-surface p-1.5 align-top", !inMonth && "bg-canvas text-subtle")}>
                    <p className="text-xs font-medium">{d.getUTCDate()}</p>
                    <div className="mt-1 grid gap-1">
                      {dayEvents.slice(0, 3).map((e, i) => (
                        <Link key={i} href={e.href} className={cn("block truncate rounded px-1 py-0.5 text-[11px]", KIND_TONE[e.kind])} title={e.label}>{e.label}</Link>
                      ))}
                      {dayEvents.length > 3 && <span className="text-[11px] text-subtle">+{dayEvents.length - 3} more</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
