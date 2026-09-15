#!/usr/bin/env bash
set -euo pipefail

# Assembles the Next standalone output into the tree Windows App Service
# (iisnode) expects: server.js + web.config at the root of the deployed
# package, with the Next server and its static assets beneath.
#
# Next traces from the monorepo root (outputFileTracingRoot in
# next.config.ts), so it mirrors the workspace path: its own server lands
# at .next/standalone/apps/dashboard/server.js and the hoisted
# dependencies at .next/standalone/node_modules.
#
# Run from the repository root after: npm run build -w @watchfire/dashboard

APP_DIR="apps/dashboard"
OUT="$APP_DIR/.next/standalone"
NESTED="$OUT/$APP_DIR"

[ -f "$NESTED/server.js" ] || {
  echo "expected $NESTED/server.js — did outputFileTracingRoot change?" >&2
  exit 1
}

mkdir -p "$NESTED/.next"
cp -r "$APP_DIR/.next/static" "$NESTED/.next/static"
[ -d "$APP_DIR/public" ] && cp -r "$APP_DIR/public" "$NESTED/public"

# Next's own server becomes next-server.js; the named-pipe wrapper takes
# its place at the deployment root, where iisnode looks for it.
mv "$NESTED/server.js" "$NESTED/next-server.js"
cp "$APP_DIR/server.js" "$OUT/server.js"
cp "$APP_DIR/web.config" "$OUT/web.config"

echo "assembled $OUT"
