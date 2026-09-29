import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl">Cookie Policy</h1>
      <div className="mt-8 space-y-5 font-sans text-sm leading-relaxed text-ink/70">
        <p>We use essential cookies to keep you signed in and to remember what&rsquo;s in your bag. These are required for the site to function and can&rsquo;t be turned off individually.</p>
        <p>We don&rsquo;t use third-party advertising or tracking cookies.</p>
      </div>
    </article>
  );
}
