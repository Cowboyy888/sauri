"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type WishlistContextValue = {
  ids: Set<string>;
  ready: boolean;
  signedIn: boolean;
  has: (productId: string) => boolean;
  toggle: (productId: string) => Promise<"added" | "removed" | "signin-required">;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    fetch("/api/wishlist").then((r) => r.json()).then((data) => {
      setSignedIn(!!data.signedIn);
      setIds(new Set<string>(data.productIds ?? []));
    }).finally(() => setReady(true));
  }, []);

  const toggle = useCallback(async (productId: string): Promise<"added" | "removed" | "signin-required"> => {
    const has = ids.has(productId);
    const res = await fetch("/api/wishlist", {
      method: has ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId }),
    });
    if (res.status === 401) return "signin-required";
    setIds((prev) => {
      const next = new Set(prev);
      if (has) next.delete(productId); else next.add(productId);
      return next;
    });
    return has ? "removed" : "added";
  }, [ids]);

  return (
    <WishlistContext.Provider value={{ ids, ready, signedIn, has: (id) => ids.has(id), toggle }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within a WishlistProvider.");
  return ctx;
}
