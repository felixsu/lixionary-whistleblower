import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:9550";
const privacyOrigin = process.env.PRIVACY_ORIGIN ?? "http://127.0.0.1:6405";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const revision = process.env.APP_REVISION ?? "local";
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error("Invalid project version in the root package.json");
}
if (!/^(local|[a-f0-9]{40})$/.test(revision)) {
  throw new Error("APP_REVISION must be a full Git SHA or local");
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  // These public values are fixed in the built assets; no runtime request is needed.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_APP_REVISION: revision,
  },
  // Same-origin API: the browser only ever talks to this app, so admin cookies stay first-party.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      {
        source: "/privacy/:path*",
        destination: `${privacyOrigin}/privacy/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
