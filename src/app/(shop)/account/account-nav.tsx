"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { signOutAction } from "./actions";

const LINKS = [
  { href: "/account", label: "Profile" },
  { href: "/account/orders", label: "Orders" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/account/reviews", label: "Reviews" },
  { href: "/account/loyalty", label: "Loyalty" },
  { href: "/account/settings", label: "Settings" },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-10 flex flex-wrap items-center gap-6 border-b border-ink/10 pb-4" aria-label="Account">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={cn("font-sans text-xs uppercase tracking-widest", pathname === l.href ? "text-ink" : "text-ink/45 hover:text-ink")}>
          {l.label}
        </Link>
      ))}
      <form action={signOutAction} className="ml-auto">
        <button type="submit" className="font-sans text-xs uppercase tracking-widest text-ink/45 hover:text-ink">Sign out</button>
      </form>
    </nav>
  );
}
