import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { getAddresses } from "@/lib/storefront/account";
import { SignInForm } from "./sign-in-form";
import { addAddressAction, removeAddressAction } from "./actions";
import { RecentlyViewed } from "@/components/storefront/product/recently-viewed";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) return <SignInForm />;

  const addresses = await getAddresses(db, customer.id);

  return (
    <div>
      <h1 className="font-display text-3xl">My Account</h1>
      <p className="mt-2 font-sans text-sm text-ink/60">Welcome back, {customer.name}.</p>

      <div className="mt-10 grid gap-10 sm:grid-cols-2">
        <section>
          <h2 className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Profile</h2>
          <dl className="mt-3 space-y-1.5 font-sans text-sm">
            <div className="flex gap-2"><dt className="text-ink/50">Name</dt><dd>{customer.name}</dd></div>
            <div className="flex gap-2"><dt className="text-ink/50">Email</dt><dd>{customer.email}</dd></div>
            {customer.phone && <div className="flex gap-2"><dt className="text-ink/50">Phone</dt><dd>{customer.phone}</dd></div>}
          </dl>
          <Link href="/account/orders" className="mt-4 inline-block font-sans text-xs uppercase tracking-widest text-ink underline-offset-4 hover:underline">View order history →</Link>
        </section>

        <section>
          <h2 className="font-sans text-[11px] uppercase tracking-[0.16em] text-ink/40">Addresses</h2>
          <ul className="mt-3 space-y-3">
            {addresses.map((a) => (
              <li key={a.id} className="border border-ink/10 p-3 font-sans text-sm text-ink/75">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p>{a.firstName} {a.lastName}{a.isDefault && <span className="ml-2 text-xs uppercase tracking-wide text-champagne">Default</span>}</p>
                    <p className="text-ink/55">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city} {a.postalCode}, {a.country}</p>
                  </div>
                  <form action={removeAddressAction}>
                    <input type="hidden" name="addressId" value={a.id} />
                    <button type="submit" className="text-xs text-ink/40 underline-offset-2 hover:text-error hover:underline">Remove</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          <details className="mt-4">
            <summary className="cursor-pointer font-sans text-xs uppercase tracking-widest text-ink/60">Add an address</summary>
            <form action={addAddressAction} className="mt-3 grid grid-cols-2 gap-2">
              <input name="firstName" placeholder="First name" required className="col-span-1 h-10 border border-ink/15 bg-transparent px-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input name="lastName" placeholder="Last name" required className="col-span-1 h-10 border border-ink/15 bg-transparent px-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input name="line1" placeholder="Address" required className="col-span-2 h-10 border border-ink/15 bg-transparent px-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input name="line2" placeholder="Apt, suite (optional)" className="col-span-2 h-10 border border-ink/15 bg-transparent px-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input name="city" placeholder="City" required className="h-10 border border-ink/15 bg-transparent px-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input name="postalCode" placeholder="Postal code" required className="h-10 border border-ink/15 bg-transparent px-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <input name="country" placeholder="Country" required className="col-span-2 h-10 border border-ink/15 bg-transparent px-2.5 font-sans text-sm focus:border-ink focus:outline-none" />
              <label className="col-span-2 flex items-center gap-2 font-sans text-xs text-ink/60"><input type="checkbox" name="isDefault" className="accent-ink" /> Set as default</label>
              <button type="submit" className="col-span-2 mt-1 h-10 bg-ink font-sans text-xs uppercase tracking-widest text-warm-white">Save address</button>
            </form>
          </details>
        </section>
      </div>

      <div className="mt-14">
        <RecentlyViewed />
      </div>
    </div>
  );
}
