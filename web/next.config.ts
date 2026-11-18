import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cpm/shared", "@cpm/server"],
};

export default nextConfig;
