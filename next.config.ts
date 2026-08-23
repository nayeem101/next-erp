import { buildSecurityHeaders } from "@/lib/security/headers";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          isDevelopment: process.env.NODE_ENV === "development",
        }),
      },
    ]);
  },
};

export default nextConfig;
