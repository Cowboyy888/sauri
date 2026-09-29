import type { Metadata } from "next";
import { BRAND } from "@/lib/storefront/brand";

export const metadata: Metadata = { title: "Our Story", description: `The story and craftsmanship behind ${BRAND.name}.` };

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-ink/40">Our Story</p>
      <h1 className="mt-3 font-display text-4xl">Jewelry made for the life you already live</h1>
      <div className="mt-8 space-y-6 font-sans text-[15px] leading-relaxed text-ink/75">
        <p>{BRAND.name} began with a simple frustration: the jewelry we loved most rarely survived contact with real life. Rings that dulled in the shower. Chains that tangled and thinned. Pieces too precious to actually wear.</p>
        <p>So we set out to make the opposite — solid gold and considered materials, cut and finished to be worn every day, not saved for occasions that never quite arrive. Every piece in the studio collection is designed first for how it feels on, and second for how it photographs.</p>
        <p>We work in small runs with a handful of studios we trust, and we&rsquo;d rather sell out of a piece than lower the standard it was made to.</p>
      </div>

      <h2 id="craftsmanship" className="mt-14 font-display text-2xl">Craftsmanship</h2>
      <div className="mt-4 space-y-6 font-sans text-[15px] leading-relaxed text-ink/75">
        <p>Each variant on this site — a metal, a size, a stone — is its own record in our inventory system, priced and costed individually. That precision starts on the bench: every piece is cast, set and polished by hand, then checked against the same standard before it ever reaches a customer.</p>
        <p>We publish the material honestly on every product page — 14K gold, 18K gold vermeil or sterling silver — because knowing what you&rsquo;re wearing is part of loving it.</p>
      </div>
    </article>
  );
}
