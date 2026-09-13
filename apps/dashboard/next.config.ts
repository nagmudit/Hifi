import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship untranspiled TypeScript builds; Next needs to know.
  transpilePackages: ["@hifi/core", "@hifi/db"],
};

export default config;
