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
  "$CTX/packages/studio" \
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
cp "$ROOT/packages/studio/package.json" "$CTX/packages/studio/package.json"
cp "$ROOT/github/package.json" "$CTX/github/package.json"

# Full source (excluding node_modules, dist, build artifacts)
RSYNC_OPTS="-a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude build \
  --exclude .cache \
  --exclude .turbo \
  --exclude .next \
  --exclude .nuxt \
  --exclude .svelte-kit \
  --exclude .expo \
  --exclude .output \
  --exclude coverage \
  --exclude tmp \
  --exclude .DS_Store \
  --exclude '*.d.ts.map' \
  --exclude '*.js.map'"

eval rsync $RSYNC_OPTS "$ROOT/packages/nikcli/"  "$CTX/packages/nikcli/"
eval rsync $RSYNC_OPTS "$ROOT/packages/script/"   "$CTX/packages/script/"
eval rsync $RSYNC_OPTS "$ROOT/packages/util/"     "$CTX/packages/util/"
eval rsync $RSYNC_OPTS "$ROOT/packages/sdk/js/"   "$CTX/packages/sdk/js/"
eval rsync $RSYNC_OPTS "$ROOT/packages/remote/"   "$CTX/packages/remote/"
eval rsync $RSYNC_OPTS "$ROOT/packages/plugin/"   "$CTX/packages/plugin/"
eval rsync $RSYNC_OPTS "$ROOT/packages/companion/" "$CTX/packages/companion/"
eval rsync $RSYNC_OPTS "$ROOT/packages/slack/"    "$CTX/packages/slack/"
# Studio server source needed at build time (nikcli embeds studio API routes)
eval rsync $RSYNC_OPTS "$ROOT/packages/studio/src/server/" "$CTX/packages/studio/src/server/"
eval rsync $RSYNC_OPTS "$ROOT/github/"            "$CTX/github/"

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
  "$CTX/github/.cache" \
  "$CTX/github/.turbo"

echo "→ Context size: $(du -sh "$CTX" | cut -f1)"
echo "→ Deploying to Railway..."

cd "$CTX"

if [ "$DETACH" = "--detach" ] || [ "$DETACH" = "-d" ]; then
  railway up --detach
  echo "✓ Deploy triggered (detached). Check status: railway logs"
else
  railway up
fi
