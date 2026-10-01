"use client";
import { useEffect } from "react";
import { trackRecentlyViewed } from "./recently-viewed";
import { track } from "@/lib/storefront/track-client";

export function TrackView({ productId }: { productId: string }) {
  useEffect(() => { trackRecentlyViewed(productId); track("product_viewed", { productId }); }, [productId]);
  return null;
}
