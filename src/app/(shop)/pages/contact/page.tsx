import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <article className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-ink/40">Contact</p>
      <h1 className="mt-3 font-display text-4xl">We&rsquo;re here to help</h1>
      <p className="mt-6 font-sans text-[15px] leading-relaxed text-ink/75">
        For order questions, sizing advice or anything else, reach us at the details below. We reply within one business day.
      </p>
      <dl className="mt-8 space-y-4 font-sans text-sm">
        <div><dt className="text-ink/45">Email</dt><dd className="mt-0.5 text-ink">hello@sauri.example</dd></div>
        <div><dt className="text-ink/45">Hours</dt><dd className="mt-0.5 text-ink">Monday–Friday, 9am–6pm</dd></div>
      </dl>
    </article>
  );
}
