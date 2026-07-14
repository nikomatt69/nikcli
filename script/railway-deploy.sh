#!/usr/bin/env bash
set -euo pipefail

# Deploy nikcli-mobile to Railway
# Usage: ./script/railway-deploy.sh [--detach]
#
# Creates a minimal build context (~10MB) to avoid Railway upload timeouts,
# syncs latest source, then runs `railway up`.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CTX="/tmp/nikcli-railway-ctx"
DETACH="${1:-}"
# The Railway project has multiple services, so `railway up` cannot pick a
# default. We must pass --service explicitly. Override with RAILWAY_SERVICE=...
# (the CI workflow also sets this from a repo variable).
SERVICE="${RAILWAY_SERVICE:-nikcli-mobile}"

echo "→ Cleaning previous Railway deploy context"
rm -rf "$CTX"

echo "→ Building minimal Railway context at $CTX"

# Create directory structure
mkdir -p \
  "$CTX/patches" \
  "$CTX/packages/nikcli" \
  "$CTX/packages/script" \
  "$CTX/packages/util" \
  "$CTX/packages/sdk/js" \
  "$CTX/packages/remote" \
  "$CTX/packages/plugin" \
  "$CTX/packages/companion" \
  "$CTX/packages/slack" \
  "$CTX/packages/llm" \
  "$CTX/packages/http-recorder" \
  "$CTX/packages/httpapi-codegen" \
  "$CTX/packages/simulation" \
  "$CTX/packages/tui-image" \
  "$CTX/github"

# Root workspace files
cp "$ROOT/package.json" "$CTX/package.json"
cp "$ROOT/bun.lock" "$CTX/bun.lock"
cp "$ROOT/Dockerfile.serve" "$CTX/Dockerfile.serve"
cp "$ROOT/railway.toml" "$CTX/railway.toml"

# Patches
rsync -a --delete "$ROOT/patches/" "$CTX/patches/"

# Package manifests only (for bun install layer)
cp "$ROOT/packages/nikcli/package.json" "$CTX/packages/nikcli/package.json"
cp "$ROOT/packages/script/package.json" "$CTX/packages/script/package.json"
cp "$ROOT/packages/util/package.json" "$CTX/packages/util/package.json"
cp "$ROOT/packages/sdk/js/package.json" "$CTX/packages/sdk/js/package.json"
cp "$ROOT/packages/remote/package.json" "$CTX/packages/remote/package.json"
cp "$ROOT/packages/plugin/package.json" "$CTX/packages/plugin/package.json"
cp "$ROOT/packages/companion/package.json" "$CTX/packages/companion/package.json"
cp "$ROOT/packages/slack/package.json" "$CTX/packages/slack/package.json"
cp "$ROOT/packages/llm/package.json" "$CTX/packages/llm/package.json"
cp "$ROOT/packages/http-recorder/package.json" "$CTX/packages/http-recorder/package.json"
cp "$ROOT/packages/httpapi-codegen/package.json" "$CTX/packages/httpapi-codegen/package.json"
cp "$ROOT/packages/simulation/package.json" "$CTX/packages/simulation/package.json"
cp "$ROOT/packages/tui-image/package.json" "$CTX/packages/tui-image/package.json"
cp "$ROOT/github/package.json" "$CTX/github/package.json"

# Full source (excluding node_modules, dist, build artifacts, and dev-only dirs)
RSYNC_OPTS=(
  -a --delete
  --exclude=node_modules
  --exclude=dist
  --exclude=build
  --exclude=.cache
  --exclude=.turbo
  --exclude=.next
  --exclude=.nuxt
  --exclude=.svelte-kit
  --exclude=.expo
  --exclude=.output
  --exclude=coverage
  --exclude=tmp
  --exclude=.DS_Store
  --exclude="*.d.ts.map"
  --exclude="*.js.map"
  --exclude=test
  --exclude=specs
  --exclude=.nikcli
  --exclude="*.md"
  --exclude="*.mdx"
)

rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/nikcli/"       "$CTX/packages/nikcli/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/script/"        "$CTX/packages/script/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/util/"          "$CTX/packages/util/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/sdk/js/"        "$CTX/packages/sdk/js/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/remote/"        "$CTX/packages/remote/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/plugin/"        "$CTX/packages/plugin/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/companion/"     "$CTX/packages/companion/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/slack/"         "$CTX/packages/slack/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/llm/"           "$CTX/packages/llm/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/http-recorder/" "$CTX/packages/http-recorder/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/httpapi-codegen/" "$CTX/packages/httpapi-codegen/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/simulation/"     "$CTX/packages/simulation/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/packages/tui-image/"     "$CTX/packages/tui-image/"
rsync "${RSYNC_OPTS[@]}" "$ROOT/github/"                 "$CTX/github/"

rm -rf \
  "$CTX/packages/nikcli/.cache" \
  "$CTX/packages/nikcli/.turbo" \
  "$CTX/packages/nikcli/.next" \
  "$CTX/packages/nikcli/.nuxt" \
  "$CTX/packages/nikcli/.svelte-kit" \
  "$CTX/packages/nikcli/.output" \
  "$CTX/packages/nikcli/coverage" \
  "$CTX/packages/nikcli/tmp" \
  "$CTX/packages/script/.cache" \
  "$CTX/packages/script/.turbo" \
  "$CTX/packages/util/.cache" \
  "$CTX/packages/util/.turbo" \
  "$CTX/packages/sdk/js/.cache" \
  "$CTX/packages/sdk/js/.turbo" \
  "$CTX/packages/remote/.cache" \
  "$CTX/packages/remote/.turbo" \
  "$CTX/packages/plugin/.cache" \
  "$CTX/packages/plugin/.turbo" \
  "$CTX/packages/companion/.cache" \
  "$CTX/packages/companion/.turbo" \
  "$CTX/packages/slack/.cache" \
  "$CTX/packages/slack/.turbo" \
  "$CTX/packages/llm/.cache" \
  "$CTX/packages/llm/.turbo" \
  "$CTX/packages/http-recorder/.cache" \
  "$CTX/packages/http-recorder/.turbo" \
  "$CTX/packages/httpapi-codegen/.cache" \
  "$CTX/packages/httpapi-codegen/.turbo" \
  "$CTX/packages/simulation/.cache" \
  "$CTX/packages/simulation/.turbo" \
  "$CTX/packages/tui-image/.cache" \
  "$CTX/packages/tui-image/.turbo" \
  "$CTX/github/.cache" \
  "$CTX/github/.turbo"

# Copy railway link info
if [ -d "$ROOT/.railway" ]; then
  echo "→ Copying Railway project link"
  cp -r "$ROOT/.railway" "$CTX/.railway"
fi

# Also check home directory for .railway (railway link stores it there)
if [ -d "$HOME/.railway" ] && [ ! -d "$ROOT/.railway" ]; then
  echo "→ Copying Railway project link from home"
  cp -r "$HOME/.railway" "$CTX/.railway"
fi

cd "$CTX"

RETRIES=3
for attempt in $(seq 1 $RETRIES); do
  if [ "$DETACH" = "--detach" ] || [ "$DETACH" = "-d" ]; then
    railway up --service "$SERVICE" --detach && echo "✓ Deploy triggered (detached, service=$SERVICE). Check status: railway logs" && exit 0
  else
    railway up --service "$SERVICE" && exit 0
  fi
  if [ $attempt -lt $RETRIES ]; then
    echo "→ Upload failed (attempt $attempt/$RETRIES), retrying in 10s..."
    sleep 10
  fi
done
echo "✗ Deploy failed after $RETRIES attempts"
exit 1
