"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { devAuthEnabled } from "@/lib/auth/session";
import { getCustomer, CUSTOMER_DEV_COOKIE } from "@/lib/customer/session";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { getDb } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addAddress, removeAddress } from "@/lib/storefront/account";
import { requestCancellation } from "@/lib/orders/cancellation";
import { createReturnRequest } from "@/lib/returns/service";
import { setConsent, setEmailPreferences, type EmailPreferences } from "@/lib/crm/customer-management";
import { createReview } from "@/lib/reviews/service";
import { redeemReward } from "@/lib/loyalty/service";
import { subscribeToBackInStock } from "@/lib/inventory/stock-notifications";
import { BusinessError } from "@/lib/errors";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
async function withCustomer<T>(fn: (customerId: string) => Promise<T>): Promise<ActionResult<T>> {
  const customer = await getCustomer(getDb());
  if (!customer) return { ok: false, error: "Please sign in again." };
  try {
    const data = await fn(customer.id);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof BusinessError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was changed." };
  }
}

export type SignInResult = { ok: boolean; message: string };

/** Sends a magic sign-in link (or, in local dev with no Supabase project, signs in directly by email). */
export async function requestSignIn(_prev: SignInResult, formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email address." };

  if (devAuthEnabled()) {
    (await cookies()).set(CUSTOMER_DEV_COOKIE, email, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    redirect("/account");
  }

  const supabase = await createSupabaseActionClient();
  if (!supabase) return { ok: false, message: "Sign-in is not available right now." };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback?next=/account` } });
  if (error) return { ok: false, message: "We could not send that link. Please try again." };
  return { ok: true, message: `Check ${email} for a sign-in link.` };
}

export async function signOutAction() {
  if (devAuthEnabled()) (await cookies()).delete(CUSTOMER_DEV_COOKIE);
  else { const supabase = await createSupabaseActionClient(); await supabase?.auth.signOut(); }
  redirect("/");
}

export async function addAddressAction(formData: FormData) {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) return;
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  await addAddress(db, customer.id, {
    type: "shipping", firstName: field("firstName"), lastName: field("lastName"), line1: field("line1"), line2: field("line2") || null,
    city: field("city"), postalCode: field("postalCode"), country: field("country"), phone: field("phone") || null,
    isDefault: formData.get("isDefault") === "on",
  });
  revalidatePath("/account");
}

export async function removeAddressAction(formData: FormData) {
  const db = getDb();
  const customer = await getCustomer(db);
  if (!customer) return;
  await removeAddress(db, customer.id, String(formData.get("addressId")));
  revalidatePath("/account");
}

const uuid = z.string().uuid();
export async function requestCancellationAction(orderId: string, reason?: string) {
  const r = await withCustomer((customerId) => requestCancellation(getDb(), customerId, uuid.parse(orderId), reason));
  if (r.ok) revalidatePath(`/account/orders/${orderId}`);
  return r;
}

/* ---------------- settings: profile, consent, email preferences (brief §14-17) ---------------- */
const Profile = z.object({ name: z.string().trim().min(1, "Enter your name.").max(160), phone: z.string().trim().max(40).optional() });
export async function updateProfileAction(input: z.input<typeof Profile>) {
  const r = await withCustomer(async (customerId) => {
    const v = Profile.parse(input);
    await getDb().update(customers).set({ name: v.name, phone: v.phone || null }).where(eq(customers.id, customerId));
  });
  if (r.ok) revalidatePath("/account/settings");
  return r;
}
const Consent = z.object({ type: z.enum(["email_marketing", "sms_marketing"]), consent: z.boolean() });
export async function setConsentAction(input: z.input<typeof Consent>) {
  const r = await withCustomer(async (customerId) => { const v = Consent.parse(input); await setConsent(getDb(), customerId, v.type, v.consent, "account_settings"); });
  if (r.ok) revalidatePath("/account/settings");
  return r;
}
const Prefs = z.object({ promotions: z.boolean().optional(), newArrivals: z.boolean().optional(), backInStock: z.boolean().optional(), loyalty: z.boolean().optional() });
export async function setEmailPreferencesAction(input: z.input<typeof Prefs>) {
  const r = await withCustomer((customerId) => setEmailPreferences(getDb(), customerId, Prefs.parse(input) as Partial<EmailPreferences>));
  if (r.ok) revalidatePath("/account/settings");
  return r;
}

/* ---------------- reviews (brief §20) ---------------- */
const NewReview = z.object({ orderId: uuid, productId: uuid, rating: z.coerce.number().int().min(1).max(5), title: z.string().trim().min(1, "Enter a title.").max(120), body: z.string().trim().min(1, "Enter your review.").max(2000) });
export async function createReviewAction(input: z.input<typeof NewReview>) {
  const r = await withCustomer((customerId) => createReview(getDb(), customerId, NewReview.parse(input)));
  if (r.ok) revalidatePath("/account/reviews");
  return r;
}

/* ---------------- loyalty (brief §27, §29) ---------------- */
export async function redeemRewardAction(rewardId: string) {
  const r = await withCustomer((customerId) => redeemReward(getDb(), customerId, uuid.parse(rewardId)));
  if (r.ok) revalidatePath("/account/loyalty");
  return r;
}

/* ---------------- back-in-stock (brief §40) ---------------- */
const StockSub = z.object({ variantId: uuid, email: z.string().email() });
export async function subscribeBackInStockAction(input: z.input<typeof StockSub>) {
  const v = StockSub.parse(input);
  const customer = await getCustomer(getDb());
  try {
    await subscribeToBackInStock(getDb(), v.variantId, v.email, customer?.id);
    return { ok: true } as ActionResult;
  } catch (e) {
    if (e instanceof BusinessError) return { ok: false, error: e.message } as ActionResult;
    return { ok: false, error: "Something went wrong." } as ActionResult;
  }
}

const ReturnLine = z.object({
  orderItemId: uuid, quantity: z.coerce.number().int().min(1), reason: z.enum(["wrong_size", "changed_mind", "damaged", "defective", "wrong_item", "not_as_expected", "other"]),
  description: z.string().trim().max(1000).optional(), photoUrls: z.array(z.string().trim().url()).max(6).optional(), exchangeRequested: z.boolean().optional(), replacementVariantId: z.string().uuid().optional(),
});
const NewReturn = z.object({ orderId: uuid, items: z.array(ReturnLine).min(1, "Select at least one item to return."), customerNotes: z.string().trim().max(1000).optional() });
export async function createReturnRequestAction(input: z.input<typeof NewReturn>) {
  const r = await withCustomer(async (customerId) => {
    const v = NewReturn.parse(input);
    const rr = await createReturnRequest(getDb(), customerId, v.orderId, v.items, v.customerNotes);
    return { id: rr.id };
  });
  if (r.ok) revalidatePath(`/account/orders/${input.orderId}`);
  return r;
}
