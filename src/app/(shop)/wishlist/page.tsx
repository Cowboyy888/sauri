import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getCustomer } from "@/lib/customer/session";
import { getWishlist } from "@/lib/storefront/wishlist";
import { ProductCard } from "@/components/storefront/shop/product-card";

export const metadata: Metadata = { title: "Wishlist" };
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const db = getDb();
  const customer = await getCustomer(db);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl">Wishlist</h1>

      {!customer ? (
        <div className="py-20 text-center">
          <p className="font-display text-xl text-ink/70">Sign in to see your wishlist.</p>
          <p className="mt-2 font-sans text-sm text-ink/50">Saved pieces sync to your account so you can pick up where you left off.</p>
          <Link href="/account?next=/wishlist" className="mt-6 inline-block border border-ink px-6 py-3 font-sans text-xs uppercase tracking-widest">Sign in</Link>
        </div>
      ) : (
        <WishlistItems customerId={customer.id} />
      )}
    </div>
  );
}

async function WishlistItems({ customerId }: { customerId: string }) {
  const products = await getWishlist(getDb(), customerId);
  if (!products.length) {
    return (
      <div className="py-20 text-center">
        <p className="font-display text-xl text-ink/70">Your wishlist is empty.</p>
        <Link href="/collections/best-sellers" className="mt-6 inline-block border border-ink px-6 py-3 font-sans text-xs uppercase tracking-widest">Shop best sellers</Link>
      </div>
    );
  }
  return (
    <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
