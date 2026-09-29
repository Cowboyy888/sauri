import Image from "next/image";
import { formatMoney } from "@/lib/money";
import type { Quote } from "@/components/storefront/cart/cart-provider";

export function OrderSummary({ quote }: { quote: Quote | null }) {
  return (
    <aside className="border border-ink/10 bg-ivory p-6">
      <h2 className="font-display text-xl">Order Summary</h2>
      <ul className="mt-5 space-y-4">
        {(quote?.lines ?? []).map((l) => (
          <li key={l.variantId} className="flex gap-3">
            <div className="relative size-16 shrink-0 overflow-hidden bg-beige-soft">
              {l.image && <Image src={l.image.url} alt={l.image.alt} fill sizes="64px" className="object-cover" />}
              <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-ink font-sans text-[10px] text-warm-white">{l.quantity}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-sm text-ink">{l.name}</p>
              <p className="truncate font-sans text-xs text-ink/50">{l.variant}</p>
              <p className="font-sans text-xs text-ink/40">{l.sku}</p>
            </div>
            <p className="shrink-0 font-sans text-sm text-ink">{formatMoney(l.lineTotalCents)}</p>
          </li>
        ))}
      </ul>

      <dl className="mt-6 space-y-1.5 border-t border-ink/10 pt-4 font-sans text-sm">
        <div className="flex justify-between"><dt className="text-ink/60">Subtotal</dt><dd>{formatMoney(quote?.subtotalCents ?? 0)}</dd></div>
        {!!quote?.discountCents && <div className="flex justify-between text-error"><dt>Discount</dt><dd>−{formatMoney(quote.discountCents)}</dd></div>}
        <div className="flex justify-between"><dt className="text-ink/60">Shipping</dt><dd>{quote?.shippingCents ? formatMoney(quote.shippingCents) : "Free"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink/60">Tax</dt><dd>{formatMoney(quote?.taxCents ?? 0)}</dd></div>
        <div className="flex justify-between border-t border-ink/10 pt-2 font-display text-lg"><dt>Total</dt><dd>{formatMoney(quote?.totalCents ?? 0)}</dd></div>
      </dl>
    </aside>
  );
}
