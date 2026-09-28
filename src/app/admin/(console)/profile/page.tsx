import { guard } from "@/lib/admin/guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Profile" };
export default async function ProfilePage() {
  const g = await guard("dashboard:read");
  const s = g.staff, perms = [...PERMISSIONS[s.role]];
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4">
      <PageHeader title="Profile" />
      <Card><CardHeader title={s.name} description={s.email} /><CardBody className="grid grid-cols-1 gap-3 text-[13px]">
        <p>Role: <b className="font-medium">{s.role[0] + s.role.slice(1).toLowerCase()}</b></p>
        <div><p className="mb-1.5 text-muted">Your permissions</p><ul className="flex flex-wrap gap-1.5">{perms.map((p) => <li key={p} className="rounded bg-line-soft px-2 py-0.5 text-xs">{p.replace(":", " · ")}</li>)}</ul></div>
        <p className="text-xs text-muted">Password and sign-in methods are managed through your Supabase account. Ask the owner to change your role.</p>
      </CardBody></Card>
    </div>
  );
}
