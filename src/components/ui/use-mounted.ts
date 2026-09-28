"use client";
import { useEffect, useState } from "react";
/** Radix menus generate ids that can differ between the server and client render; mount them in the browser only. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
