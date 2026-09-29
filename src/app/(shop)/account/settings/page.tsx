import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { customers } from "@/lib/db/schema";
import { getEmailPreferences } from "@/lib/crm/customer-management";
import { SettingsForm } from "@/components/storefront/account/settings-form";

export const metadata: Metadata = { title: "Account Settings" };
export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) redirect("/account?next=/account/settings");
  const [row] = await db.select({ marketingOptIn: customers.marketingOptIn, smsMarketingConsent: customers.smsMarketingConsent }).from(customers).where(eq(customers.id, customer.id));
  const prefs = await getEmailPreferences(db, customer.id);

  return (
    <div>
      <h1 className="font-display text-3xl">Settings</h1>
      <div className="mt-8 max-w-lg">
        <SettingsForm
          name={customer.name} phone={customer.phone ?? ""} email={customer.email}
          emailConsent={row?.marketingOptIn ?? false} smsConsent={row?.smsMarketingConsent ?? false}
          preferences={prefs}
        />
      </div>
    </div>
  );
}
