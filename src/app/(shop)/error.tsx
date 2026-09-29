"use client";
import Link from "next/link";
import { useEffect } from "react";

export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto max-w-lg px-6 py-28 text-center">
      <p className="font-sans text-xs uppercase tracking-[0.2em] text-ink/40">Something went wrong</p>
      <h1 className="mt-3 font-display text-3xl">We hit a snag loading this page</h1>
      <p className="mt-3 font-sans text-sm text-ink/60">Please try again — if it keeps happening, let us know.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="border border-ink px-5 py-2.5 font-sans text-xs uppercase tracking-widest">Try again</button>
        <Link href="/" className="px-5 py-2.5 font-sans text-xs uppercase tracking-widest text-ink/60 hover:text-ink">Back home</Link>
      </div>
    </div>
  );
}
