import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Product images uploaded from the admin live in Supabase Storage (public bucket).
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }] },
  // `pg` is a Node-only driver; keep it out of the bundler.
  serverExternalPackages: ["pg", "exceljs", "jspdf", "jspdf-autotable"],
};

export default nextConfig;
