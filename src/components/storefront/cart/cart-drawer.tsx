"use client";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetCloseButton } from "@/components/storefront/layout/sheet";
import { useCart, type QuotedLine } from "./cart-provider";
import { formatMoney } from "@/lib/money";
import { STORE } from "@/lib/config";

function CartLineRow({ line }: { line: QuotedLine }) {
  const { setQuantity, removeLine } = useCart();
  return (
    <li className="flex gap-4 py-5">
      <Link href={line.slug ? `/products/${line.slug}` : "#"} className="relative size-20 shrink-0 overflow-hidden bg-beige-soft">
        {line.image ? <Image src={line.image.url} alt={line.image.alt} fill sizes="80px" className="object-cover" /> : null}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={line.slug ? `/products/${line.slug}` : "#"} className="font-display text-[15px] text-ink hover:text-ink/70">{line.name}</Link>
            <p className="mt-0.5 font-sans text-xs text-ink/50">{line.variant}</p>
          </div>
          <button type="button" aria-label={`Remove ${line.name}`} onClick={() => removeLine(line.variantId)} className="p-1 text-ink/40 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center border border-ink/15">
            <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(line.variantId, line.quantity - 1)} className="p-1.5 hover:bg-ink/5"><Minus className="size-3.5" /></button>
            <span className="w-7 text-center font-sans text-sm tabular-nums">{line.quantity}</span>
            <button type="button" aria-label="Increase quantity" disabled={line.quantity >= line.available} onClick={() => setQuantity(line.variantId, line.quantity + 1)} className="p-1.5 hover:bg-ink/5 disabled:opacity-30"><Plus className="size-3.5" /></button>
          </div>
          <p className="font-sans text-sm text-ink">{formatMoney(line.lineTotalCents)}</p>
        </div>
        {line.quantity > line.available && <p className="mt-1 font-sans text-xs text-error">Only {line.available} left — quantity adjusted at checkout.</p>}
      </div>
    </li>
  );
}

export function CartDrawer() {
  const { isOpen, close, open, lines, quote, loading, count, discountCode, setDiscountCode } = useCart();
  const [codeInput, setCodeInput] = useState(discountCode);
  const hasProblems = !!quote?.problems.length;

  return (
    <Sheet open={isOpen} onOpenChange={(o) => (o ? open() : close())}>
      <SheetContent title="Your bag" side="right" className="p-0">
        <div className="flex items-center justify-between border-b border-ink/10 px-6 py-5">
          <h2 className="font-display text-xl">Your Bag {count > 0 && <span className="font-sans text-sm text-ink/50">({count})</span>}</h2>
          <SheetCloseButton />
        </div>

        {!lines.length ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="font-display text-lg text-ink/70">Your bag is empty</p>
            <Link href="/collections/best-sellers" onClick={close} className="border border-ink px-5 py-2.5 font-sans text-xs uppercase tracking-widest">Shop best sellers</Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-ink/10 overflow-y-auto px-6">
              {(quote?.lines ?? []).map((l) => <CartLineRow key={l.variantId} line={l} />)}
            </ul>
            <div className="border-t border-ink/10 px-6 py-5">
              {hasProblems && (
                <ul className="mb-3 space-y-1 font-sans text-xs text-error">{quote!.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
              <form
                onSubmit={(e) => { e.preventDefault(); setDiscountCode(codeInput.trim()); }}
                className="mb-4 flex gap-2"
              >
                <input
                  value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Discount code"
                  className="h-10 flex-1 border border-ink/15 bg-transparent px-3 font-sans text-sm placeholder:text-ink/35 focus:border-ink focus:outline-none"
                />
                <button type="submit" className="border border-ink px-4 font-sans text-xs uppercase tracking-widest">Apply</button>
              </form>
              {quote?.discountError && <p className="-mt-3 mb-3 font-sans text-xs text-error">{quote.discountError}</p>}

              <dl className="space-y-1.5 font-sans text-sm">
                <div className="flex justify-between"><dt className="text-ink/60">Subtotal</dt><dd>{formatMoney(quote?.subtotalCents ?? 0)}</dd></div>
                {!!quote?.discountCents && <div className="flex justify-between text-error"><dt>Discount</dt><dd>−{formatMoney(quote.discountCents)}</dd></div>}
                <div className="flex justify-between"><dt className="text-ink/60">Shipping</dt><dd>{quote && quote.subtotalCents - quote.discountCents >= STORE.freeShippingThresholdCents ? "Free" : formatMoney(quote?.shippingCents ?? 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink/60">Tax</dt><dd>{formatMoney(quote?.taxCents ?? 0)}</dd></div>
                <div className="flex justify-between border-t border-ink/10 pt-2 font-display text-base"><dt>Total</dt><dd>{formatMoney(quote?.totalCents ?? 0)}</dd></div>
              </dl>

              <Link href="/checkout" onClick={close} className={`mt-5 flex w-full items-center justify-center bg-ink px-5 py-3.5 font-sans text-xs uppercase tracking-[0.14em] text-warm-white transition-opacity hover:bg-ink/85 ${hasProblems ? "pointer-events-none opacity-40" : ""}`}>
                {loading ? "Updating…" : "Checkout"}
              </Link>
              <Link href="/cart" onClick={close} className="mt-3 block text-center font-sans text-xs uppercase tracking-widest text-ink/60 underline-offset-4 hover:underline">View bag</Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
