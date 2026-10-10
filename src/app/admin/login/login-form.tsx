"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

/** Supabase email + password sign-in. The session cookie is then verified on the server for every request. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [err, setErr] = useState<string | null>(null), [sent, setSent] = useState(false), [pending, start] = useTransition();

  if (mode === "forgot") {
    return (
      <form className="mt-5 grid gap-3.5" action={(fd) => start(async () => {
        setErr(null);
        // The link lands on /auth/callback, which exchanges the one-time code for a session, then on the reset page.
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/admin/reset-password")}`;
        const { error } = await client().auth.resetPasswordForEmail(String(fd.get("email")).trim(), { redirectTo });
        if (error) { setErr(error.message); return; }
        setSent(true);
      })}>
        {sent ? (
          <p role="status" className="rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent">If that email belongs to a staff account, a reset link is on its way. Check your inbox and spam folder.</p>
        ) : (
          <>
            <p className="text-[13px] text-muted">Enter your staff email and we’ll send you a link to choose a new password.</p>
            <Field label="Email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
            {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
            <Button variant="primary" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
          </>
        )}
        <button type="button" onClick={() => { setMode("signin"); setSent(false); setErr(null); }} className="text-left text-[13px] text-muted underline-offset-2 hover:text-fg hover:underline">Back to sign in</button>
      </form>
    );
  }

  return (
    <form className="mt-5 grid gap-3.5" action={(fd) => start(async () => {
      setErr(null);
      const { error } = await client().auth.signInWithPassword({ email: String(fd.get("email")), password: String(fd.get("password")) });
      if (error) { setErr(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message); return; }
      router.replace(next); router.refresh();
    })}>
      <Field label="Email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
      <Button variant="primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <button type="button" onClick={() => { setMode("forgot"); setErr(null); }} className="text-left text-[13px] text-muted underline-offset-2 hover:text-fg hover:underline">Forgot password?</button>
    </form>
  );
}
