"use client";
import { useEffect } from "react";
import { trackRecentlyViewed } from "./recently-viewed";

export function TrackView({ productId }: { productId: string }) {
  useEffect(() => { trackRecentlyViewed(productId); }, [productId]);
  return null;
}
