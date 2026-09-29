import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listStaff } from "@/lib/admin/misc";
import { PERMISSIONS, AREAS } from "@/lib/auth/permissions";
import { STORE } from "@/lib/config";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AddStaffForm, StaffRow } from "@/components/admin/owner-forms";

export const metadata = { title: "Settings" };
const ROLES = ["OWNER", "ADMIN", "SALES", "INVENTORY", "VIEWER"] as const;

export default async function SettingsPage() {
  const g = await guard("settings:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const staff = g.can("staff:read") ? await listStaff(getDb()) : [];
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Settings" actions={g.can("audit:read") && <Link href="/admin/audit-log" className="text-[13px] font-medium text-accent hover:underline">Audit log</Link>} />
      <Card>
        <CardHeader title="Staff and roles" description="Staff sign in with their own account. Access is granted by adding their email here; the last active owner can’t be removed." />
        <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Staff</caption>
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pl-4 font-medium">Name</th><th className="px-3 font-medium">Role</th><th className="hidden px-3 font-medium sm:table-cell">Account</th><th className="pr-4" /></tr></thead>
          <tbody>{staff.map((u) => <StaffRow key={u.id} u={u} self={u.id === g.staff.userId} />)}</tbody></table></div>
        {g.can("staff:write") && <AddStaffForm />}
      </Card>
      <Card>
        <CardHeader title="What each role can do" description="Enforced on the server for every page, action and API call." />
        <div className="relative overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Permissions</caption>
          <thead><tr className="border-b border-line text-xs text-muted"><th className="py-2 pl-4 text-left font-medium">Area</th>{ROLES.map((r) => <th key={r} className="px-3 text-center font-medium">{r[0] + r.slice(1).toLowerCase()}</th>)}</tr></thead>
          <tbody>{AREAS.map((a) => <tr key={a} className="border-b border-line-soft last:border-0"><td className="py-1.5 pl-4 capitalize">{a}</td>{ROLES.map((r) => <td key={r} className="px-3 text-center">{PERMISSIONS[r].has(`${a}:write`) ? "Edit" : PERMISSIONS[r].has(`${a}:read`) ? "View" : <span className="text-subtle">—</span>}</td>)}</tr>)}</tbody></table></div>
      </Card>
      <Card>
        <CardHeader title="Shipping & returns" description="Shipping methods, delivery estimates, and the return policy customers see (brief §15, §26)." />
        <CardBody className="flex flex-wrap gap-3">
          <Link href="/admin/settings/shipping" className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] font-medium text-accent hover:bg-canvas">Shipping methods →</Link>
          <Link href="/admin/settings/returns" className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] font-medium text-accent hover:bg-canvas">Returns policy →</Link>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Store rules" description="Set in code (src/lib/config.ts) for now." />
        <CardBody className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
          {[["Currency", STORE.currency], ["Business time zone", STORE.timezone], ["Sales tax", `${STORE.taxRateBp / 100}%`], ["Free shipping from", money(STORE.freeShippingThresholdCents)], ["Standard / express shipping", `${money(STORE.standardShippingCents)} / ${money(STORE.expressShippingCents)}`], ["Large-order alert from", money(STORE.largeOrderCents)]].map(([k, v]) => <div key={k} className="flex justify-between border-b border-line-soft py-1.5"><span className="text-muted">{k}</span><span>{v}</span></div>)}
        </CardBody>
      </Card>
    </div>
  );
}
