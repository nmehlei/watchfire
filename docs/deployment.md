# Deployment

Watchfire has two deployable pieces with deliberately different paths: the agent ships
as a container image, the dashboard ships as a Node application to an App Service.

## The agent

**Build.** GitHub Actions builds `apps/agent/Dockerfile` with the repository root
as its build context — npm workspaces keep a single lockfile there, so the image
cannot be built from `apps/agent/` alone:

```bash
docker build -f apps/agent/Dockerfile --tag iris .
```

**Runtime layout.** The image is deliberately flat, and anything deploying it
depends on that shape:

| Path | What |
|---|---|
| `/app/dist` | compiled agent |
| `/app/bin` | adapter wrappers, also shimmed into `/usr/local/bin` |
| `/app/config` | **example** tenant registry only |
| `/app/node_modules` | production dependencies |
| `/app/package.json` | the agent's manifest (`"type": "module"`) |

Verify after any change to the build:

```bash
docker run --rm --entrypoint ls iris -1 /app
# bin config dist node_modules package.json
```

**Configuration.** The image carries only `config/*.example.yaml`. Real tenant
configuration is mounted at runtime and pointed at by environment variables:

| Variable | Meaning |
|---|---|
| `IRIS_TENANTS_PATH` | tenant registry, e.g. `/etc/iris/config/tenants.yaml` |
| `IRIS_RESOURCES_PATH` | cross-tenant resource graph |
| `IRIS_DB_PATH` | SQLite memory database |
| `IRIS_TRANSCRIPT_DIR` | per-run transcripts |
| `IRIS_NIGHTLY_CRON` | nightly sweep schedule (node-cron expression, `Europe/Berlin`). Default `30 2 * * *` (daily 02:30). Lower cost by widening it, e.g. `30 2 * * 1,3,5` for Mon/Wed/Fri — trades run frequency for detection lag. |
| `IRIS_CATCHUP_STALE_HOURS` | startup catch-up fires if the last successful nightly is older than this. Default `24`. **Must be raised to cover the longest gap `IRIS_NIGHTLY_CRON` can produce** (e.g. `76` for Mon/Wed/Fri, covering the 72h Fri→Mon gap with margin) — otherwise a container restart on a between-run day fires an unplanned extra sweep and quietly erodes the savings from a sparser cron. |

Mount the registry read-only; Watchfire never writes to it. The container runs as an
unprivileged user, so the files must be world-readable (`0644`).

🚨 **The image ships example configuration only.** `config/tenants.example.yaml` and
`config/resources.example.yaml` are placeholders — deliberately, so that no operator's
tenant data is baked into a published image. A container started without a real
registry mounted, or without `IRIS_TENANTS_PATH` pointing at one, **will not start**:
it exits naming the file it could not find. That is the intended failure; it is far
better than silently sweeping four tenants that do not exist.

**Rollout.** The reference deployment pulls the image on a timer and swaps the
container when the tag resolves to a new digest, so a merge to the default branch
reaches the host without anyone running a deploy. Pin the image to an immutable
`sha-` tag to freeze a release; the pull then becomes a permanent no-op.

Configuration, secret and compose changes are *not* covered by that timer — they
are applied by the infrastructure repository's own deploy step.

## The dashboard

Azure Pipelines builds and deploys it; GitHub Actions never touches it. The
pipeline definition lives at `apps/dashboard/ci/azure-pipelines.yml` and is scoped
by a path filter, so agent-only commits do not trigger a dashboard deploy.

**Packaging.** Next traces the standalone output from the workspace root, so its
server lands at `.next/standalone/apps/dashboard/server.js` rather than at the
root of `standalone/`. `apps/dashboard/ci/assemble-standalone.sh` rearranges that
into what iisnode expects — the named-pipe wrapper and `web.config` at the
deployment root, the Next server and its static assets beneath. Run it the same
way locally as the pipeline does:

```bash
npm run build -w @watchfire/dashboard
./apps/dashboard/ci/assemble-standalone.sh
PORT=3123 node apps/dashboard/.next/standalone/server.js
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3123/api/health   # 200
```

`/api/health` is excluded from the auth gate; every other route redirects to
sign-in.

### Cutting the pipeline over to the monorepo

The dashboard used to live in its own Azure DevOps repository. After the move, the
pipeline must build from the monorepo instead. This is manual, one-time work in the
Azure DevOps project:

1. Create a **GitHub service connection** in the project (Project settings →
   Service connections), granting access to the Watchfire repository.
2. Edit the existing pipeline → **Settings** → repoint its source to the GitHub
   repository, with the YAML path `apps/dashboard/ci/azure-pipelines.yml`.
3. Set the pipeline variable `irisApiUrl` to the Watchfire API's public URL.
4. Run the pipeline once from `main` and confirm the App Service serves the new
   build.

🚨 **Only then archive the old repository.** Archiving before a GitHub-sourced run
has deployed successfully leaves the dashboard with no working deploy path.

## The published image

The agent image is published publicly on every push to `main`:

```bash
docker pull ghcr.io/nmehlei/watchfire:latest
```

Tags are `latest`, `main`, and `sha-<commit>` for an immutable pin. Building from
source stays fully supported and is the right choice if you want to audit what you
run — the `docker build` line above produces the same image.

### Notice: the image contains Anthropic components

**The image bundles the Claude Agent SDK and the Claude Code executable
(`@anthropic-ai/claude-agent-sdk` and its platform packages, ~206 MB).** These are
proprietary, are **not** covered by this project's AGPL licence, and remain governed
by [Anthropic's own terms](https://code.claude.com/docs/en/legal-and-compliance).
This notice is the condition attached to the Section 7 additional permission in
[`LICENSE`](../LICENSE); if you redistribute the image or offer it as a network
service, you must pass this notice on.

Anthropic's terms permit shipping Claude Code preinstalled in a product subject to
conditions. The two that constrain how you deploy Watchfire:

- **The binary must not be modified.** Watchfire installs it unmodified from npm and
  never patches it. Don't strip or alter it in a derived image.
- **You must not resell or intermediate Claude usage.** Every operator supplies their
  own `ANTHROPIC_API_KEY`, and that usage is billed to them under their own agreement
  with Anthropic. Watchfire holds no key on anyone's behalf — do not run it as a
  shared service that bills Claude usage through your account.
