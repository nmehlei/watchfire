import "server-only";

import { env } from "./env";

interface IrisFetchOptions extends Omit<RequestInit, "headers"> {
  /** Extra headers merged on top of the bearer + content-type defaults. */
  headers?: Record<string, string>;
}

/**
 * Server-side fetch wrapper that injects the Watchfire bearer token. Must only
 * be invoked from RSCs, Route Handlers, or Server Actions. The bearer never
 * leaves the App Service environment — client code uses the BFF proxy at
 * /api/watchfire/* instead.
 */
export async function irisFetch(path: string, options: IrisFetchOptions = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${env.IRIS_API_URL}${path}`;
  return fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${env.IRIS_API_TOKEN}`,
      accept: "application/json",
      ...options.headers,
    },
  });
}

/** Typed JSON wrapper for read endpoints. Throws on non-2xx. */
export async function irisJson<T>(path: string, options: IrisFetchOptions = {}): Promise<T> {
  const res = await irisFetch(path, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Watchfire ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
