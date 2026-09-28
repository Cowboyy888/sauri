"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** Supabase email + password sign-in. The session cookie is then verified on the server for every request. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <form className="mt-5 grid gap-3.5" action={(fd) => start(async () => {
      setErr(null);
      const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      const { error } = await supabase.auth.signInWithPassword({ email: String(fd.get("email")), password: String(fd.get("password")) });
      if (error) { setErr(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message); return; }
      router.replace(next); router.refresh();
    })}>
      <Field label="Email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
      <Button variant="primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
