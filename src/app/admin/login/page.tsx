export const metadata = { title: "Staff sign-in", robots: { index: false } };

/** Placeholder. The sign-in form (Supabase email + password / magic link) is built with the admin UI in Phase 2. */
export default function StaffLogin() {
  return (
    <main className="grid min-h-screen place-items-center bg-admin-bg p-8 font-[system-ui]">
      <div className="max-w-sm rounded-lg border border-neutral-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Staff sign-in</h1>
        <p className="mt-2 text-sm text-neutral-600">Sign-in is added with the admin dashboard in Phase 2. Access is granted to Supabase accounts that match an active row in the staff users table.</p>
      </div>
    </main>
  );
}
