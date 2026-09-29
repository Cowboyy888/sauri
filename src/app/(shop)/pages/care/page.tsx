import type { Metadata } from "next";

export const metadata: Metadata = { title: "Jewelry Care" };

const GUIDES = [
  { title: "Solid gold (14K, 18K vermeil)", body: "Wipe with a soft cloth after wearing to remove oils and lotion. Store pieces separately to avoid scratching, and remove before swimming in chlorinated water." },
  { title: "Sterling silver", body: "Silver will naturally tarnish over time — a gentle polish with a silver cloth restores the shine. Keep it in an airtight pouch when not in use." },
  { title: "Pearls", body: "Pearls are soft. Put them on last, after perfume and hairspray, and wipe with a damp cloth before storing flat." },
  { title: "Everyday wear", body: "Every piece here is designed to be worn daily, including in the shower — but avoid harsh chemicals, chlorine and abrasive surfaces, which dull any finish over time." },
];

export default function CarePage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-ink/40">Care Guide</p>
      <h1 className="mt-3 font-display text-4xl">Keeping your jewelry looking new</h1>
      <div className="mt-10 space-y-8">
        {GUIDES.map((g) => (
          <div key={g.title} className="border-t border-ink/10 pt-5">
            <h2 className="font-display text-xl">{g.title}</h2>
            <p className="mt-2 font-sans text-[15px] leading-relaxed text-ink/70">{g.body}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
