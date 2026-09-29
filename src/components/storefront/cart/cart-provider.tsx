"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartPersonalization = { initial?: string; engraving?: string };
export type CartLine = { variantId: string; quantity: number; personalization?: CartPersonalization };
export type QuotedLine = {
  variantId: string; productId: string; slug: string | null; sku: string; name: string; variant: string;
  quantity: number; unitPriceCents: number; lineTotalCents: number; available: number;
  image: { url: string; alt: string } | null;
};
export type Quote = {
  lines: QuotedLine[]; subtotalCents: number; discountCents: number; shippingCents: number; taxCents: number; totalCents: number;
  discountError: string | null; problems: string[];
};

const STORAGE_KEY = "lumea-cart";
const lineKey = (l: Pick<CartLine, "variantId" | "personalization">) => `${l.variantId}|${l.personalization?.initial ?? ""}|${l.personalization?.engraving ?? ""}`;

type CartContextValue = {
  lines: CartLine[];
  /** False until localStorage has been read once. `lines` is [] before this too, so callers that treat
   *  an empty cart as significant (checkout's empty-cart redirect, "your bag is empty" states) must wait
   *  for this — otherwise every fresh page load looks empty for one tick before hydrating. */
  hydrated: boolean;
  quote: Quote | null;
  loading: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  count: number;
  discountCode: string;
  setDiscountCode: (code: string) => void;
  shippingMethodId: string | null;
  setShippingMethodId: (id: string | null) => void;
  addLine: (variantId: string, quantity?: number, personalization?: CartPersonalization) => void;
  setQuantity: (variantId: string, quantity: number, personalization?: CartPersonalization) => void;
  removeLine: (variantId: string, personalization?: CartPersonalization) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [shippingMethodId, setShippingMethodId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch { /* private mode or corrupted storage: start with an empty bag */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lines)); } catch { /* ignore */ }
  }, [lines, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (!lines.length) { setQuote(null); return; }
    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch("/api/cart/quote", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ lines, discountCode: discountCode || undefined, shippingMethodId: shippingMethodId || undefined }),
      })
        .then((r) => r.json())
        .then((data) => setQuote(data))
        .catch(() => { /* aborted or offline: keep the last known quote */ })
        .finally(() => setLoading(false));
    }, 200);
    return () => { controller.abort(); clearTimeout(t); };
  }, [lines, discountCode, shippingMethodId, hydrated]);

  // Abandoned-cart tracking (brief §19) — a no-op server-side for anyone not signed in.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      fetch("/api/cart/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines: lines.map(({ variantId, quantity }) => ({ variantId, quantity })) }) }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [lines, hydrated]);

  const addLine = useCallback((variantId: string, quantity = 1, personalization?: CartPersonalization) => {
    setLines((prev) => {
      const key = lineKey({ variantId, personalization });
      const existing = prev.find((l) => lineKey(l) === key);
      if (existing) return prev.map((l) => (lineKey(l) === key ? { ...l, quantity: l.quantity + quantity } : l));
      return [...prev, { variantId, quantity, personalization }];
    });
    setIsOpen(true);
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number, personalization?: CartPersonalization) => {
    const key = lineKey({ variantId, personalization });
    setLines((prev) => (quantity <= 0 ? prev.filter((l) => lineKey(l) !== key) : prev.map((l) => (lineKey(l) === key ? { ...l, quantity } : l))));
  }, []);

  const removeLine = useCallback((variantId: string, personalization?: CartPersonalization) => {
    const key = lineKey({ variantId, personalization });
    setLines((prev) => prev.filter((l) => lineKey(l) !== key));
  }, []);

  const clear = useCallback(() => { setLines([]); setDiscountCode(""); setShippingMethodId(null); }, []);

  const count = useMemo(() => lines.reduce((a, l) => a + l.quantity, 0), [lines]);

  const value: CartContextValue = {
    lines, hydrated, quote, loading, isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false),
    count, discountCode, setDiscountCode, shippingMethodId, setShippingMethodId, addLine, setQuantity, removeLine, clear,
  };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider.");
  return ctx;
}
