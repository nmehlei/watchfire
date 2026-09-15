# Watchfire-Dashboard

Next.js front-end for [Watchfire](https://github.com/your-org/Watchfire) — autonomous read-only SRE agent watching ACME's infrastructure. The dashboard surfaces findings, runs, mutes, cost, and adapter health; it talks to Watchfire via the bearer-gated REST + SSE surfaces (spec 11).

**Design:** [`Watchfire/specs/12-dashboard.md`](https://github.com/your-org/Watchfire/blob/main/specs/12-dashboard.md) is the source of truth. Read it before changing behavior.

## Architecture in one paragraph

Next.js 16 (App Router) running natively on a Windows App Service. Operator signs in via Microsoft Entra (single-operator gate via `app_role_assignment_required = true` at the AAD layer). Auth.js v5 mints a JWT session cookie. Every Watchfire call goes through the dashboard's server-side BFF (`/api/watchfire/[...path]`) which injects the bearer — the token never reaches the browser. Live updates flow over SSE: dashboard's `/api/events` opens a server-side EventSource to Watchfire and pipes events through to the client.

## Local development

```bash
# 1. Install deps
npm ci

# 2. Local env — copy template + fill in real values
cp .env.example .env.local
# AAD_* come from `terraform output` in your-iac-repo/solutions/watchfire-dashboard
# WATCHFIRE_API_TOKEN is the same bearer Watchfire itself uses
# AUTH_SECRET: openssl rand -base64 32

# 3. Run
npm run dev
# http://localhost:3000 — middleware will redirect to Microsoft sign-in
```

The AAD app registration includes `http://localhost:3000/api/auth/callback/microsoft-entra-id` only if you add it as a redirect URI in `your-iac-repo/solutions/watchfire-dashboard/terraform/main.tf` — currently it lists the App Service hostname and the custom domain only, so local sign-in won't complete until that's amended.

## Scripts

| script | what |
|---|---|
| `npm run dev` | Next dev server (Turbopack) |
| `npm run build` | Production build (`output: 'standalone'`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run test` | Vitest unit + component tests |
| `npm run test:e2e` | Playwright |

## Deploy

CI: `ci/azure-pipelines.yml` on Azure DevOps. On push to `main`:

1. Build stage runs `npm ci`, lint, typecheck, test, `next build`, assembles the standalone tree, publishes a zip artifact.
2. Deploy stage uses the `watchfire-dashboard-deploy-sc` Azure RM service connection (`Website Contributor` on `watchfire-dashboard-RG`) to push via `AzureWebApp@1` with `deploymentMethod: zipDeploy` and `startUpCommand: node server.js`.

Infrastructure (RG, Web App, AAD app, custom domain, cert) lives in `your-iac-repo/solutions/watchfire-dashboard/`. Application code never touches Azure resources directly — Terraform owns them.

## Project layout

```
src/
  auth.ts                       Auth.js v5 root (handlers + auth + signIn + signOut)
  proxy.ts                      Auth gate (was `middleware.ts` pre-Next-16)
  app/
    layout.tsx                  Root layout + PWA metadata
    page.tsx                    Overview placeholder (real overview lands next)
    api/
      auth/[...nextauth]/       Auth.js GET + POST handlers
      watchfire/[...path]/           BFF proxy → Watchfire, bearer-injecting
      events/                   SSE proxy → Watchfire /api/events
      health/                   Public liveness probe (excluded from auth gate)
  lib/
    env.ts                      Server-side env validation (zod)
    watchfire.ts                     `watchfireFetch` + `watchfireJson` helpers (server-only)
public/
  manifest.json                 PWA manifest (icons TBD)
  sw.js                         Placeholder service worker
ci/
  azure-pipelines.yml           Build + deploy pipeline
```

## Status

**Scaffolding only.** No pages yet beyond the overview placeholder. Per spec 12 §Build order step 5, pages land in this order: overview → findings → runs → mutes → search.
