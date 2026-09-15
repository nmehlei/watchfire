"use client";

import { useEffect } from "react";

/**
 * Register the production service worker on first render.
 *
 * In development we deliberately don't register: HMR and the SW's
 * cache-first strategies fight each other and hide local changes. The
 * placeholder SW from the scaffold has been replaced by the real
 * implementation in public/sw.js (spec 12 §PWA layer).
 *
 * Also actively *unregisters* any previously installed SW when running
 * a dev build — if the operator hits the dev server after using the
 * production build locally, stale caches would otherwise serve old code.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) r.unregister();
      });
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.error("SW registration failed", err));
  }, []);

  return null;
}
