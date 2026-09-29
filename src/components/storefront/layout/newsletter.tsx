"use client";
import { useState } from "react";

export function Newsletter({ className }: { className?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  return (
    <div className={className}>
      <p className="font-display text-2xl">Jewelry worth remembering.</p>
      <p className="mt-2 font-sans text-sm text-ink/60">New arrivals, early access and stories from the studio — no more than twice a month.</p>
      {status === "done" ? (
        <p className="mt-5 font-sans text-sm text-ink">Thank you — you&rsquo;re on the list.</p>
      ) : (
        <form
          className="mt-5 flex max-w-sm gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setStatus("loading");
            try {
              const res = await fetch("/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
              setStatus(res.ok ? "done" : "error");
            } catch { setStatus("error"); }
          }}
        >
          <input
            required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address"
            className="h-11 flex-1 border border-ink/20 bg-transparent px-3 font-sans text-sm placeholder:text-ink/40 focus:border-ink focus:outline-none"
          />
          <button type="submit" disabled={status === "loading"} className="h-11 shrink-0 bg-ink px-5 font-sans text-xs uppercase tracking-[0.14em] text-warm-white disabled:opacity-60">
            {status === "loading" ? "…" : "Join"}
          </button>
        </form>
      )}
      {status === "error" && <p className="mt-2 font-sans text-xs text-error">Something went wrong. Please try again.</p>}
    </div>
  );
}
