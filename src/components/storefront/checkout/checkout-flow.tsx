"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { useCart } from "@/components/storefront/cart/cart-provider";
import { OrderSummary } from "./order-summary";
import { formatMoney } from "@/lib/money";
import type { ShippingMethodOption } from "@/lib/storefront/shipping";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");

const COUNTRIES = [
  { code: "US", name: "United States" }, { code: "CA", name: "Canada" }, { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" }, { code: "SG", name: "Singapore" }, { code: "KH", name: "Cambodia" },
];

type AddressForm = { firstName: string; lastName: string; company: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; phone: string };
const emptyAddress: AddressForm = { firstName: "", lastName: "", company: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US", phone: "" };

const inputCls = "h-11 w-full border border-ink/15 bg-transparent px-3 font-sans text-sm placeholder:text-ink/35 focus:border-ink focus:outline-none";
const labelCls = "font-sans text-xs uppercase tracking-widest text-ink/50";

function AddressFields({ value, onChange, idPrefix }: { value: AddressForm; onChange: (v: AddressForm) => void; idPrefix: string }) {
  const set = <K extends keyof AddressForm>(k: K, v: AddressForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-1 grid gap-1"><span className={labelCls}>First name</span><input required value={value.firstName} onChange={(e) => set("firstName", e.target.value)} className={inputCls} /></label>
      <label className="col-span-1 grid gap-1"><span className={labelCls}>Last name</span><input required value={value.lastName} onChange={(e) => set("lastName", e.target.value)} className={inputCls} /></label>
      <label className="col-span-2 grid gap-1"><span className={labelCls}>Company (optional)</span><input value={value.company} onChange={(e) => set("company", e.target.value)} className={inputCls} /></label>
      <label className="col-span-2 grid gap-1"><span className={labelCls}>Address</span><input required value={value.line1} onChange={(e) => set("line1", e.target.value)} className={inputCls} /></label>
      <label className="col-span-2 grid gap-1"><span className={labelCls}>Apartment / unit (optional)</span><input value={value.line2} onChange={(e) => set("line2", e.target.value)} className={inputCls} /></label>
      <label className="col-span-1 grid gap-1"><span className={labelCls}>City</span><input required value={value.city} onChange={(e) => set("city", e.target.value)} className={inputCls} /></label>
      <label className="col-span-1 grid gap-1"><span className={labelCls}>State / province</span><input value={value.state} onChange={(e) => set("state", e.target.value)} className={inputCls} /></label>
      <label className="col-span-1 grid gap-1"><span className={labelCls}>Postal code</span><input required value={value.postalCode} onChange={(e) => set("postalCode", e.target.value)} className={inputCls} /></label>
      <label className="col-span-1 grid gap-1">
        <span className={labelCls}>Country</span>
        <select required value={value.country} onChange={(e) => set("country", e.target.value)} className={inputCls}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="col-span-2 grid gap-1"><span className={labelCls}>Phone (optional)</span><input id={`${idPrefix}-phone`} value={value.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} /></label>
    </div>
  );
}

export function CheckoutFlow({ shippingMethods }: { shippingMethods: ShippingMethodOption[] }) {
  const router = useRouter();
  const { lines, hydrated, quote, discountCode, shippingMethodId, setShippingMethodId, clear } = useCart();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [shipping, setShipping] = useState<AddressForm>(emptyAddress);
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const [billing, setBilling] = useState<AddressForm>(emptyAddress);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    if (hydrated && !lines.length && !clientSecret && !redirected) { setRedirected(true); router.replace("/cart"); }
  }, [hydrated, lines.length, clientSecret, redirected, router]);

  useEffect(() => {
    if (!shippingMethodId && shippingMethods[0]) setShippingMethodId(shippingMethods[0].id);
  }, [shippingMethodId, shippingMethods, setShippingMethodId]);

  const hasProblems = !!quote?.problems.length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout/session", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines, discountCode: discountCode || undefined, shippingMethodId,
          customer: { email, name: `${shipping.firstName} ${shipping.lastName}`.trim(), phone: phone || undefined },
          shippingAddress: { ...shipping, phone: shipping.phone || phone || undefined },
          billingAddress: billingSameAsShipping ? undefined : billing,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong. Please try again."); return; }
      setClientSecret(data.clientSecret);
      setOrderId(data.orderId);
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const onComplete = useMemo(() => () => { clear(); router.push(`/checkout/success?order=${orderId ?? ""}`); }, [clear, router, orderId]);

  if (clientSecret) {
    return (
      <div className="mx-auto max-w-xl">
        <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <form onSubmit={handleSubmit} className="space-y-10">
        <section>
          <h2 className="font-display text-xl">Contact Information</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="col-span-2 grid gap-1 sm:col-span-1"><span className={labelCls}>Email</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></label>
            <label className="col-span-2 grid gap-1 sm:col-span-1"><span className={labelCls}>Phone</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></label>
          </div>
        </section>

        <section>
          <h2 className="font-display text-xl">Shipping Address</h2>
          <div className="mt-4"><AddressFields value={shipping} onChange={setShipping} idPrefix="shipping" /></div>
        </section>

        <section>
          <h2 className="font-display text-xl">Billing Address</h2>
          <label className="mt-4 flex items-center gap-2 font-sans text-sm text-ink/75">
            <input type="checkbox" checked={billingSameAsShipping} onChange={(e) => setBillingSameAsShipping(e.target.checked)} className="size-4 accent-ink" />
            Billing address same as shipping
          </label>
          {!billingSameAsShipping && <div className="mt-4"><AddressFields value={billing} onChange={setBilling} idPrefix="billing" /></div>}
        </section>

        <section>
          <h2 className="font-display text-xl">Shipping Method</h2>
          <div className="mt-4 space-y-2">
            {shippingMethods.map((m) => (
              <label key={m.id} className={`flex cursor-pointer items-center justify-between gap-3 border p-4 font-sans text-sm ${shippingMethodId === m.id ? "border-ink" : "border-ink/15"}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="shippingMethod" checked={shippingMethodId === m.id} onChange={() => setShippingMethodId(m.id)} className="accent-ink" />
                  <span>
                    <span className="block text-ink">{m.name}</span>
                    <span className="block text-xs text-ink/50">{m.description}</span>
                  </span>
                </span>
                <span className="text-ink">{formatMoney(m.priceCents)}</span>
              </label>
            ))}
          </div>
        </section>

        {error && <p role="alert" className="border border-error/30 bg-error/5 px-4 py-3 font-sans text-sm text-error">{error}</p>}
        {hasProblems && <ul className="space-y-1 font-sans text-sm text-error">{quote!.problems.map((p) => <li key={p}>{p}</li>)}</ul>}

        <button type="submit" disabled={submitting || hasProblems || !lines.length} className="w-full bg-ink py-4 font-sans text-xs uppercase tracking-[0.14em] text-warm-white transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40">
          {submitting ? "Preparing payment…" : "Continue to Payment"}
        </button>
      </form>

      <OrderSummary quote={quote} />
    </div>
  );
}
