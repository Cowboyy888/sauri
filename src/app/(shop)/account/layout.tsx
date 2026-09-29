import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { AccountNav } from "./account-nav";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const customer = await getCustomer(getDb());
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {customer && <AccountNav />}
      {children}
    </div>
  );
}
