import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listAllShippingMethods } from "@/lib/admin/shipping-methods";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/states";
import { NewShippingMethodButton, ShippingMethodRowActions, ShippingMethodSummary } from "@/components/admin/shipping-settings";

export const metadata = { title: "Shipping settings" };

export default async function ShippingSettingsPage() {
  const g = await guard("settings:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const methods = await listAllShippingMethods(getDb());
  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/settings" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Settings</Link>
      <PageHeader title="Shipping methods" description="Configurable shipping methods used at checkout — pricing, delivery estimate, and geography/order-value eligibility (brief §15, §17)." actions={g.can("settings:write") && <NewShippingMethodButton />} />
      <Card>
        {!methods.length ? <EmptyState title="No shipping methods yet" description="Add one so shoppers can check out." /> : (
          <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Shipping methods</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Method</th><th className="px-3 font-medium">Price</th><th className="hidden px-3 font-medium sm:table-cell">Delivery</th><th className="hidden px-3 font-medium md:table-cell">Eligibility</th><th className="px-3 font-medium">Status</th><th className="pr-4" /></tr></thead>
            <tbody>{methods.map((m) => (
              <tr key={m.id} className="border-b border-line-soft last:border-0">
                <td className="py-2.5 pl-4"><p className="font-medium">{m.name}</p>{m.description && <p className="text-xs text-muted">{m.description}</p>}</td>
                <td className="px-3">{money(m.priceCents)}</td>
                <td className="hidden px-3 text-muted sm:table-cell">{m.estimatedMinDays}–{m.estimatedMaxDays} days</td>
                <td className="hidden px-3 md:table-cell"><ShippingMethodSummary method={m} /></td>
                <td className="px-3"><StatusBadge status={m.active ? "active" : "inactive"} /></td>
                <td className="px-3 pr-4">{g.can("settings:write") && <ShippingMethodRowActions method={m} />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
