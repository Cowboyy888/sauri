import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `pg` is a Node-only driver; keep it out of the bundler.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
