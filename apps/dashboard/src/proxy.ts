import { auth } from "./auth";

/**
 * Auth gate. Every request hits this — `auth` populates req.auth and,
 * when no session exists, redirects to the configured sign-in page.
 *
 * The matcher excludes:
 *   - /api/auth/* (Auth.js's own routes)
 *   - /api/health (App Service liveness probe, must be public)
 *   - /_next/static, /_next/image, /favicon.ico (static assets)
 *   - PWA assets (/manifest.json, /sw.js, /icons/*)
 */
export default auth((req) => {
  if (!req.auth && !req.nextUrl.pathname.startsWith("/api/auth")) {
    const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return Response.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/).*)",
  ],
};
