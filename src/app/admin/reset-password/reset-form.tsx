"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function ResetForm() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null), [pending, start] = useTransition();
  return (
    <form className="mt-5 grid gap-3.5" action={(fd) => start(async () => {
      setErr(null);
      const password = String(fd.get("password")), confirm = String(fd.get("confirm"));
      if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
      if (password !== confirm) { setErr("The two passwords don’t match."); return; }
      const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setErr(error.message); return; }
      router.replace("/admin/dashboard"); router.refresh();
    })}>
      <Field label="New password"><Input name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus /></Field>
      <Field label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></Field>
      {err && <p role="alert" className="rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">{err}</p>}
      <Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save password"}</Button>
      <Link href="/admin/login" className="text-[13px] text-muted underline-offset-2 hover:text-fg hover:underline">Back to sign in</Link>
    </form>
  );
}
