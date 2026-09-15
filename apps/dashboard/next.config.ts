import path from "node:path";
import type { NextConfig } from "next";

// The npm workspace root: apps/dashboard -> apps -> repository root.
const MONOREPO_ROOT = path.resolve(__dirname, "../..");

// Content Security Policy. Spec 12 §Security calls for "strict
// default-src self with an explicit allow for the AAD endpoints during
// sign-in". Notes on the choices:
//
//   - 'unsafe-inline' on script/style: Next.js + Tailwind v4 emit inline
//     scripts and styles. Moving to a strict nonce policy is a follow-up
//     once the app stabilises; given the single-operator gate at AAD,
//     the marginal XSS surface is small.
//
//   - connect-src 'self': BFF + SSE both live on the same origin. The
//     bearer never reaches the browser, so no Watchfire-direct connection is
//     ever made.
//
//   - form-action allows login.microsoftonline.com: the Auth.js sign-in
//     form POSTs through Next which then 302s the browser there — the
//     final navigation is a form submission for the OAuth handshake.
//
//   - frame-ancestors 'none' + base-uri 'self': clickjacking + base tag
//     injection hardening.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self' https://login.microsoftonline.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // Produces .next/standalone/ with a self-contained server.js — what
  // the Azure DevOps pipeline packages and uploads to App Service.
  output: "standalone",

  // Strict request-time auth: every page is dynamic by default, no
  // static prerendering of authenticated views.
  typedRoutes: true,

  // Pin Turbopack and file tracing to the workspace root. The hoisted
  // node_modules live two directories up, and Turbopack does not resolve
  // modules outside its root; standalone output must trace from the same
  // place so the hoisted dependencies land in the deployable tree.
  turbopack: {
    root: MONOREPO_ROOT,
  },
  outputFileTracingRoot: MONOREPO_ROOT,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
