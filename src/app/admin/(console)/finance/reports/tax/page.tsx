import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { resolveRange } from "@/lib/analytics/service";
import { getTaxReport, getTaxSettings } from "@/lib/finance/tax";
import { guard } from "@/lib/admin/guard";
import { one, parseRange, rangeLabel, rangeQuery, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { money, int, pct } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KPICard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/states";
import { TaxSettingsForm } from "@/components/admin/finance-forms";

export const metadata = { title: "Tax summary" };

export default async function TaxReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("finance:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, db = getDb(), parsed = parseRange(sp), r = await resolveRange(db, parsed.key, parsed.custom);
  const res = await safe("tax-summary", async () => ({ report: await getTaxReport(db, r), settings: await getTaxSettings(db) }), one(sp.fail));
  const canWrite = g.can("finance:write");

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Tax summary" description={rangeLabel(parsed)}>
        <Link href={`/admin/finance/reports?${new URLSearchParams(rangeQuery(parsed))}`} className="text-[13px] font-medium text-accent hover:underline">← All reports</Link>
      </PageHeader>
      {!res.ok ? <EmptyState title="Unable to load tax data." /> : !res.data.report.configured ? (
        <Card><CardBody><EmptyState title="Tax configuration required" description="No tax configuration is set up yet — figures are not shown to avoid inventing a rate." /></CardBody></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPICard label="Taxable sales" value={money(res.data.report.taxableSalesCents)} change={null} comparison="" />
            <KPICard label="Tax-exempt sales" value={money(res.data.report.taxExemptSalesCents)} change={null} comparison="" hint="No exemption rules are configured yet — always $0" />
            <KPICard label="Tax collected" value={money(res.data.report.taxAmountCents)} change={null} comparison="" note={`${res.data.report.ratePercent}% configured rate`} />
            <KPICard label="Recognized orders" value={int(res.data.report.orders)} change={null} comparison="" />
          </div>
          <Card>
            <CardHeader title="Configuration" description="This is reporting context for the rate already applied at checkout — editing it here does not change past orders." />
            <CardBody>{canWrite ? <TaxSettingsForm enabled={res.data.settings!.enabled} taxRatePercent={res.data.settings!.taxRateBp / 100} label={res.data.settings!.label} /> : (
              <p className="text-[13.5px]">{res.data.settings!.label}: {pct(res.data.settings!.taxRateBp / 100)} {res.data.settings!.enabled ? "" : "(disabled)"}</p>
            )}</CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
