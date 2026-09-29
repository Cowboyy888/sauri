import type { Metadata } from "next";
import { Bodoni_Moda, Inter } from "next/font/google";
import { BRAND } from "@/lib/storefront/brand";
import "./globals.css";

const display = Bodoni_Moda({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display-loaded" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans-loaded" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: `${BRAND.name} | Fine jewelry`, template: `%s | ${BRAND.name}` },
  description: "Thoughtfully designed jewelry made to become part of your everyday story.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="bg-paper text-ink antialiased">{children}</body>
    </html>
  );
}
