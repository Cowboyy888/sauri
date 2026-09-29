"use client";
import { useActionState } from "react";
import { requestSignIn, type SignInResult } from "./actions";

const initial: SignInResult = { ok: false, message: "" };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(requestSignIn, initial);
  return (
    <div className="mx-auto max-w-sm py-16 text-center">
      <h1 className="font-display text-3xl">Sign in</h1>
      <p className="mt-2 font-sans text-sm text-ink/60">We&rsquo;ll email you a link — no password to remember.</p>
      <form action={formAction} className="mt-6 flex flex-col gap-3">
        <input required type="email" name="email" placeholder="Email address" aria-label="Email address" className="h-11 border border-ink/20 bg-transparent px-3 text-center font-sans text-sm placeholder:text-ink/40 focus:border-ink focus:outline-none" />
        <button type="submit" disabled={pending} className="h-11 bg-ink font-sans text-xs uppercase tracking-[0.14em] text-warm-white disabled:opacity-60">
          {pending ? "Sending…" : "Continue"}
        </button>
      </form>
      {state.message && <p className={`mt-4 font-sans text-sm ${state.ok ? "text-ink" : "text-error"}`}>{state.message}</p>}
    </div>
  );
}
