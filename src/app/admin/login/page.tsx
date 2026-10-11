import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { devAuthEnabled, getStaff, supabaseConfigured } from "@/lib/auth/session";
import { listStaff } from "@/lib/admin/misc";
import { LoginForm } from "./login-form";
import { devSignInAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign-in | SAURI", robots: { index: false } };

export default async function StaffLogin({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/admin") && !next.startsWith("/admin/login") ? next : "/admin/dashboard";
  const db = getDb();
  if (await getStaff(db)) redirect(safeNext);
  const dev = devAuthEnabled();
  const staff = dev ? await listStaff(db) : [];
  return (
    <main className="admin relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div className="login-bg" aria-hidden="true">
        <span className="login-spark" style={{ top: "8%", left: "12%", "--s": "18px", "--delay": "0s", "--d": "6s", "--c": "#b89c6c" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "22%", left: "70%", "--s": "10px", "--delay": "1.2s", "--d": "5s", "--c": "#2f5d50" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "15%", left: "40%", "--s": "12px", "--delay": "2.4s", "--d": "7s", "--c": "#b89c6c" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "34%", left: "88%", "--s": "16px", "--delay": "0.6s", "--d": "6s", "--c": "#b89c6c" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "48%", left: "6%", "--s": "14px", "--delay": "3.1s", "--d": "5s", "--c": "#2f5d50" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "58%", left: "30%", "--s": "10px", "--delay": "1.8s", "--d": "8s", "--c": "#b89c6c" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "66%", left: "78%", "--s": "20px", "--delay": "0.3s", "--d": "7s", "--c": "#b89c6c" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "76%", left: "14%", "--s": "12px", "--delay": "2.9s", "--d": "6s", "--c": "#2f5d50" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "84%", left: "52%", "--s": "16px", "--delay": "1.5s", "--d": "5s", "--c": "#b89c6c" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "90%", left: "86%", "--s": "10px", "--delay": "3.6s", "--d": "7s", "--c": "#2f5d50" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "42%", left: "58%", "--s": "10px", "--delay": "4.2s", "--d": "6s", "--c": "#b89c6c" } as React.CSSProperties} />
        <span className="login-spark" style={{ top: "28%", left: "22%", "--s": "10px", "--delay": "0.9s", "--d": "9s", "--c": "#2f5d50" } as React.CSSProperties} />
      </div>
      <div className="relative w-full max-w-sm admin-rise">
        <p className="mb-6 text-center font-display text-[20px] tracking-[0.32em]">SAURI</p>
        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="text-[17px] font-semibold">Staff sign-in</h1>
          <p className="mt-1 text-[13px] text-muted">Business dashboard for SAURI staff.</p>
          {error === "no-access" && <p role="alert" className="mt-4 rounded-md bg-[#f8e9e6] px-3 py-2 text-[13px] text-neg">This account isn’t an active staff member. Ask the owner to add your email.</p>}
          {supabaseConfigured() ? <LoginForm next={safeNext} /> : dev ? (
            <div className="mt-5 grid gap-2">
              <p className="rounded-md bg-[#f7eedd] px-3 py-2 text-xs text-warn">Development mode: Supabase isn’t configured, so choose a staff account to sign in as. This option does not exist in production.</p>
              {staff.filter((s) => s.active).map((s) => (
                <form key={s.id} action={devSignInAction.bind(null, s.email, safeNext)}>
                  <button className="flex w-full items-center justify-between rounded-md border border-line px-3 py-2.5 text-left text-[13.5px] hover:border-accent hover:bg-accent-soft">
                    <span><span className="block font-medium">{s.name}</span><span className="text-xs text-muted">{s.email}</span></span>
                    <span className="rounded bg-line-soft px-2 py-0.5 text-xs font-medium text-muted">{s.role.toLowerCase()}</span>
                  </button>
                </form>
              ))}
            </div>
          ) : <p className="mt-4 text-[13px] text-muted">Sign-in is not configured.</p>}
        </div>
      </div>
    </main>
  );
}
