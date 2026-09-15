import { z } from "zod";

/**
 * Server-side environment access. Validated once at module load so a
 * missing or malformed setting fails fast at startup rather than during
 * a request. Never imported by client code — the bearer must not leak
 * to the browser.
 */
const ServerEnv = z.object({
  IRIS_API_URL: z.string().url(),
  IRIS_API_TOKEN: z.string().min(1),

  AUTH_SECRET: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_ID: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.string().url(),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = ServerEnv.safeParse(process.env);

if (!parsed.success) {
  // Print which keys failed before the process exits so the App Service
  // log stream shows a useful root cause rather than a generic crash.
  console.error("Server env failed validation:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid server environment — see logs above.");
}

export const env = parsed.data;
