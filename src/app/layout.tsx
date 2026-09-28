import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SAURI | Fine jewelry", template: "%s | SAURI" },
  description: "Solid gold, lab-grown diamonds and freshwater pearls, designed to be worn every day.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink antialiased">{children}</body>
    </html>
  );
}
