import Link from "next/link";

export default function ProductNotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-28 text-center">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-ink/40">404</p>
      <h1 className="mt-3 font-display text-3xl">We couldn&rsquo;t find that piece</h1>
      <p className="mt-3 font-sans text-sm text-ink/60">It may be sold out permanently or the link may be out of date.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/collections/best-sellers" className="border border-ink px-5 py-2.5 font-sans text-xs uppercase tracking-widest">Shop best sellers</Link>
        <Link href="/" className="px-5 py-2.5 font-sans text-xs uppercase tracking-widest text-ink/60 hover:text-ink">Back home</Link>
      </div>
    </div>
  );
}
