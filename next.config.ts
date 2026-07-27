import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://192.168.11.110:3000"],
  // Verified live: these reach every response path proxy.ts produces
  // (the 401 JSON on unauthenticated API calls, the 307 redirect to
  // /login, and normal page responses) — no need to duplicate them
  // inside proxy.ts itself. Content-Security-Policy is NOT set here — it
  // needs a fresh per-request nonce, so it's built and set in proxy.ts
  // instead; a static CSP here would fight with that one for the same
  // header name.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;