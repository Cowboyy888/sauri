"use client";
import { useState, useTransition } from "react";
import { setConsentAction, setEmailPreferencesAction, updateProfileAction } from "@/app/(shop)/account/actions";
import type { EmailPreferences } from "@/lib/crm/customer-management";

const inputCls = "h-11 w-full border border-ink/15 bg-transparent px-3 font-sans text-sm placeholder:text-ink/35 focus:border-ink focus:outline-none disabled:text-ink/40";
const labelCls = "font-sans text-xs uppercase tracking-widest text-ink/50";

const PREF_LABELS: [keyof EmailPreferences, string][] = [
  ["promotions", "Promotions"], ["newArrivals", "New Arrivals"], ["backInStock", "Back-in-Stock"], ["loyalty", "Loyalty"],
];

export function SettingsForm({ name, phone, email, emailConsent, smsConsent, preferences }: {
  name: string; phone: string; email: string; emailConsent: boolean; smsConsent: boolean; preferences: EmailPreferences;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(preferences);
  const [emailOpt, setEmailOpt] = useState(emailConsent);
  const [smsOpt, setSmsOpt] = useState(smsConsent);

  return (
    <div className="grid gap-10">
      <section>
        <h2 className={labelCls}>Profile</h2>
        <form className="mt-3 grid gap-3" action={(fd) => start(async () => {
          setMsg(null);
          const r = await updateProfileAction({ name: String(fd.get("name") ?? ""), phone: String(fd.get("phone") ?? "") || undefined });
          setMsg(r.ok ? "Saved" : r.error);
        })}>
          <label className="grid gap-1"><span className={labelCls}>Name</span><input name="name" defaultValue={name} required className={inputCls} /></label>
          <label className="grid gap-1"><span className={labelCls}>Email</span><input value={email} disabled className={inputCls} /></label>
          <label className="grid gap-1"><span className={labelCls}>Phone</span><input name="phone" defaultValue={phone} className={inputCls} /></label>
          <button type="submit" disabled={pending} className="h-11 justify-self-start border border-ink bg-ink px-6 font-sans text-xs uppercase tracking-widest text-warm-white disabled:opacity-50">{pending ? "Saving…" : "Save profile"}</button>
        </form>
      </section>

      <section>
        <h2 className={labelCls}>Marketing consent</h2>
        <p className="mt-1 font-sans text-xs text-ink/50">Order, shipping and return updates are always sent — these only control marketing messages.</p>
        <div className="mt-3 grid gap-2">
          <label className="flex items-center gap-2 font-sans text-sm"><input type="checkbox" checked={emailOpt} className="size-4 accent-ink" onChange={(e) => { setEmailOpt(e.target.checked); start(async () => { await setConsentAction({ type: "email_marketing", consent: e.target.checked }); }); }} />Email marketing</label>
          <label className="flex items-center gap-2 font-sans text-sm"><input type="checkbox" checked={smsOpt} className="size-4 accent-ink" onChange={(e) => { setSmsOpt(e.target.checked); start(async () => { await setConsentAction({ type: "sms_marketing", consent: e.target.checked }); }); }} />SMS marketing</label>
        </div>
      </section>

      {emailOpt && (
        <section>
          <h2 className={labelCls}>Email preferences</h2>
          <div className="mt-3 grid gap-2">
            {PREF_LABELS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 font-sans text-sm">
                <input type="checkbox" checked={prefs[key]} className="size-4 accent-ink" onChange={(e) => { const next = { ...prefs, [key]: e.target.checked }; setPrefs(next); start(async () => { await setEmailPreferencesAction({ [key]: e.target.checked }); }); }} />
                {label}
              </label>
            ))}
          </div>
        </section>
      )}
      {msg && <p className="font-sans text-sm text-ink">{msg}</p>}
    </div>
  );
}
