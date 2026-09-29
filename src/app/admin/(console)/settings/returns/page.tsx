import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { getReturnPolicy } from "@/lib/returns/service";
import { categories } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ReturnPolicyForm } from "@/components/admin/return-policy-form";

export const metadata = { title: "Returns policy" };

export default async function ReturnsSettingsPage() {
  const g = await guard("settings:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const db = getDb();
  const [policy, cats] = await Promise.all([getReturnPolicy(db), db.select({ slug: categories.slug, name: categories.name }).from(categories).orderBy(asc(categories.position))]);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Link href="/admin/settings" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ChevronLeft className="size-4" />Settings</Link>
      <PageHeader title="Returns policy" description="Drives the eligibility check on a customer's return request and the copy shown on /pages/returns (brief §26)." />
      <Card>
        <CardHeader title="Policy" />
        <CardBody>{g.can("settings:write") ? <ReturnPolicyForm policy={policy} categories={cats} /> : <p className="text-[13px] text-muted">Read-only — only an owner can change the return policy.</p>}</CardBody>
      </Card>
    </div>
  );
}
