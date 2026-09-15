# syntax=docker/dockerfile:1.7

# ───── Build stage ─────
FROM node:26-bookworm-slim AS build
WORKDIR /app

# Build deps for native modules (better-sqlite3 in particular).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# The build context is the repository root: npm workspaces keep one
# lockfile there, so the agent cannot be built from its own directory.
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
# Manifest only — the dashboard's source is excluded by .dockerignore.
# npm validates every workspace in the lockfile, so its package.json has
# to be present even though nothing from it ships in this image.
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --workspace @watchfire/agent --include-workspace-root

COPY apps/agent/tsconfig.json apps/agent/vitest.config.ts apps/agent/
COPY apps/agent/src apps/agent/src
COPY apps/agent/config apps/agent/config
COPY infra/ssh infra/ssh

WORKDIR /app/apps/agent

# Runs under the same Linux/Node combination as the production image. Keep
# this target in CI so native addons cannot pass locally then fail in deploy.
FROM build AS test
RUN npm test

FROM build AS compile
RUN npm run build

# Strip dev deps from the production tree.
RUN npm prune --omit=dev --workspace @watchfire/agent --include-workspace-root


# ───── Runtime stage ─────
FROM node:26-bookworm-slim AS runtime
WORKDIR /app

# Minimal shell utilities used by bin/ wrappers. `openssl` ships in the
# base image already; keeping this image lean.
RUN groupadd --system watchfire \
    && useradd --system --gid watchfire --home-dir /home/watchfire --create-home --shell /usr/sbin/nologin watchfire \
    && mkdir -p /var/lib/watchfire /run/watchfire /etc/watchfire \
    && chown -R watchfire:watchfire /var/lib/watchfire /run/watchfire /home/watchfire

COPY --from=compile --chown=watchfire:watchfire /app/apps/agent/dist ./dist
COPY --from=compile --chown=watchfire:watchfire /app/node_modules ./node_modules
COPY --from=compile --chown=watchfire:watchfire /app/apps/agent/package.json ./package.json
COPY --chown=watchfire:watchfire apps/agent/bin ./bin
# Examples only. The real registry is mounted at runtime and pointed at by
# WATCHFIRE_TENANTS_PATH / WATCHFIRE_RESOURCES_PATH — never bake it into the image.
COPY --chown=watchfire:watchfire apps/agent/config ./config

RUN chmod +x /app/bin/* \
    && for f in /app/bin/*; do \
         name="$(basename "$f")"; \
         printf '#!/bin/sh\nexec /app/bin/%s "$@"\n' "$name" > "/usr/local/bin/$name"; \
         chmod +x "/usr/local/bin/$name"; \
       done

USER watchfire
ENV NODE_ENV=production
# Adapters resolvable two ways:
#   1. /app/bin (in PATH for the watchfire user when shells inherit ENV)
#   2. /usr/local/bin/<name> shims that exec the real script — these are
#      reachable even when the Claude SDK sanitizes its Bash subprocess'
#      PATH (the SDK does that for security). Shims preserve $0 → /app/bin
#      so the script's dirname-based self-location still works.
ENV PATH="/app/bin:${PATH}"
# Pin the Claude Agent SDK to the glibc native binary. The SDK's runtime
# libc detection mis-identifies bookworm-slim as musl in some setups and
# tries to exec the (broken on glibc) musl variant. Runner reads this env
# var and passes it as pathToClaudeCodeExecutable to query().
ENV WATCHFIRE_CLAUDE_CODE_PATH=/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude
EXPOSE 8080
CMD ["node", "dist/index.js"]
