import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset password | SAURI", robots: { index: false } };

/** Reached from the emailed link via /auth/callback, which has already turned the one-time code into a session. */
export default function ResetPasswordPage() {
  return (
    <main className="admin grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center font-display text-[20px] tracking-[0.32em]">SAURI</p>
        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="text-[17px] font-semibold">Choose a new password</h1>
          <p className="mt-1 text-[13px] text-muted">Use at least 8 characters.</p>
          <ResetForm />
        </div>
      </div>
    </main>
  );
}
