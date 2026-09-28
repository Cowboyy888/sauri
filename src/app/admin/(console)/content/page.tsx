import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { getContent } from "@/lib/admin/misc";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { ContentForm } from "@/components/admin/owner-forms";

export const metadata = { title: "Content" };
export default async function ContentPage() {
  const g = await guard("content:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const v = await getContent(getDb());
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Content" description="Site-wide text used by the storefront (built in Phase 3). Changes are audited." />
      <div className="rounded-lg border border-line bg-surface p-4"><ContentForm v={v} /></div>
    </div>
  );
}
