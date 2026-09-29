"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { useCart } from "@/components/storefront/cart/cart-provider";
import { formatMoney } from "@/lib/money";
import { STORE } from "@/lib/config";
import { Breadcrumb } from "@/components/storefront/shop/breadcrumb";

export default function CartPage() {
  const { lines, hydrated, quote, loading, discountCode, setDiscountCode, setQuantity, removeLine } = useCart();
  const [codeInput, setCodeInput] = useState(discountCode);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Breadcrumb items={[{ label: "Bag" }]} />
      <h1 className="mt-4 font-display text-4xl">Your Bag</h1>

      {!hydrated ? null : !lines.length ? (
        <div className="py-24 text-center">
          <p className="font-display text-xl text-ink/70">Your bag is empty.</p>
          <Link href="/collections/best-sellers" className="mt-6 inline-block border border-ink px-6 py-3 font-sans text-xs uppercase tracking-widest">Shop best sellers</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_360px]">
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {(quote?.lines ?? []).map((l) => (
              <li key={l.variantId} className="flex gap-5 py-6">
                <Link href={l.slug ? `/products/${l.slug}` : "#"} className="relative size-28 shrink-0 overflow-hidden bg-beige-soft">
                  {l.image && <Image src={l.image.url} alt={l.image.alt} fill sizes="112px" className="object-cover" />}
                </Link>
                <div className="flex flex-1 flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={l.slug ? `/products/${l.slug}` : "#"} className="font-display text-lg hover:text-ink/70">{l.name}</Link>
                      <p className="mt-1 font-sans text-sm text-ink/50">{l.variant}</p>
                      <p className="mt-1 font-sans text-sm text-ink/70">{formatMoney(l.unitPriceCents)} each</p>
                    </div>
                    <button type="button" aria-label={`Remove ${l.name}`} onClick={() => removeLine(l.variantId)} className="p-1 text-ink/40 hover:text-ink"><X className="size-4" /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center border border-ink/15">
                      <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(l.variantId, l.quantity - 1)} className="p-2 hover:bg-ink/5"><Minus className="size-3.5" /></button>
                      <span className="w-8 text-center font-sans text-sm tabular-nums">{l.quantity}</span>
                      <button type="button" aria-label="Increase quantity" disabled={l.quantity >= l.available} onClick={() => setQuantity(l.variantId, l.quantity + 1)} className="p-2 hover:bg-ink/5 disabled:opacity-30"><Plus className="size-3.5" /></button>
                    </div>
                    <p className="font-sans text-base">{formatMoney(l.lineTotalCents)}</p>
                  </div>
                  {l.quantity > l.available && <p className="mt-1 font-sans text-xs text-error">Only {l.available} left — quantity will be adjusted at checkout.</p>}
                </div>
              </li>
            ))}
          </ul>

          <div>
            {!!quote?.problems.length && <ul className="mb-4 space-y-1 font-sans text-xs text-error">{quote.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <form onSubmit={(e) => { e.preventDefault(); setDiscountCode(codeInput.trim()); }} className="mb-5 flex gap-2">
              <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Discount code" className="h-11 flex-1 border border-ink/15 bg-transparent px-3 font-sans text-sm placeholder:text-ink/35 focus:border-ink focus:outline-none" />
              <button type="submit" className="border border-ink px-4 font-sans text-xs uppercase tracking-widest">Apply</button>
            </form>
            {quote?.discountError && <p className="-mt-3 mb-4 font-sans text-xs text-error">{quote.discountError}</p>}

            <dl className="space-y-2 border-t border-ink/10 pt-5 font-sans text-sm">
              <div className="flex justify-between"><dt className="text-ink/60">Subtotal</dt><dd>{formatMoney(quote?.subtotalCents ?? 0)}</dd></div>
              {!!quote?.discountCents && <div className="flex justify-between text-error"><dt>Discount</dt><dd>−{formatMoney(quote.discountCents)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink/60">Shipping</dt><dd>{quote && quote.subtotalCents - quote.discountCents >= STORE.freeShippingThresholdCents ? "Free" : formatMoney(quote?.shippingCents ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink/60">Estimated tax</dt><dd>{formatMoney(quote?.taxCents ?? 0)}</dd></div>
              <div className="flex justify-between border-t border-ink/10 pt-3 font-display text-lg"><dt>Total</dt><dd>{formatMoney(quote?.totalCents ?? 0)}</dd></div>
            </dl>

            <Link href="/checkout" className={`mt-6 flex w-full items-center justify-center bg-ink py-4 font-sans text-xs uppercase tracking-[0.14em] text-warm-white hover:bg-ink/85 ${quote?.problems.length ? "pointer-events-none opacity-40" : ""}`}>
              {loading ? "Updating…" : "Checkout"}
            </Link>
            <p className="mt-3 font-sans text-xs text-ink/45">Totals shown here are recalculated on the server and are never trusted from the browser.</p>
          </div>
        </div>
      )}
    </div>
  );
}
