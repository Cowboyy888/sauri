import Link from "next/link";
import { BRAND } from "@/lib/storefront/brand";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-lg tracking-wide">{BRAND.name}</p>
      <p className="mt-8 font-sans text-xs uppercase tracking-[0.2em] text-ink/40">404</p>
      <h1 className="mt-3 font-display text-3xl">Page not found</h1>
      <p className="mt-3 font-sans text-sm text-ink/60">The page you&rsquo;re looking for may have moved.</p>
      <Link href="/" className="mt-8 border border-ink px-6 py-3 font-sans text-xs uppercase tracking-widest">Back home</Link>
    </div>
  );
}
