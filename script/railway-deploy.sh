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
DOCKERFILE="$ROOT/Dockerfile.serve"
DETACH="${1:-}"
# The Railway project has multiple services, so `railway up` cannot pick a
# default. We must pass --service explicitly. Override with RAILWAY_SERVICE=...
# (the CI workflow also sets this from a repo variable).
SERVICE="${RAILWAY_SERVICE:-nikcli-mobile}"

# Every path Dockerfile.serve COPYs out of the build context. `--from=` stages
# copy between image layers, not from the context, so they are skipped. The last
# argument of a COPY is the destination.
context_copy_sources() {
  grep -E '^COPY ' "$DOCKERFILE" |
    grep -v -- '--from=' |
    awk '{ for (i = 2; i < NF; i++) print $i }' |
    sort -u
}

# The workspace packages the image needs in full. Derived from the Dockerfile
# rather than hardcoded: this list drifted once already (packages/discord was
# added to the image but not here, and every deploy failed on `COPY
# packages/discord/package.json` for two days), so the two must not be
# maintained separately. Everything else in the workspace is stubbed inside the
# image and must stay out of the upload.
# while-read rather than mapfile: /bin/bash on macOS is still 3.2 and has no
# mapfile, and this script is run by hand as often as by CI.
PACKAGES=()
PACKAGE_COUNT=0
while IFS= read -r pkg; do
  PACKAGES+=("$pkg")
  PACKAGE_COUNT=$((PACKAGE_COUNT + 1))
done < <(
  grep -oE '^COPY packages/[A-Za-z0-9._/-]+/package\.json' "$DOCKERFILE" |
    awk '{ print $2 }' |
    sed -E 's:/package\.json$::' |
    sort -u
)

if [ "$PACKAGE_COUNT" -eq 0 ]; then
  echo "✗ No package COPY lines found in $DOCKERFILE — refusing to upload an empty context"
  exit 1
fi

echo "→ Cleaning previous Railway deploy context"
rm -rf "$CTX"

echo "→ Building minimal Railway context at $CTX ($PACKAGE_COUNT packages)"

mkdir -p "$CTX/patches"
for pkg in "${PACKAGES[@]}"; do
  mkdir -p "$CTX/$pkg"
done

# Root workspace files
cp "$ROOT/package.json" "$CTX/package.json"
cp "$ROOT/bun.lock" "$CTX/bun.lock"
cp "$ROOT/Dockerfile.serve" "$CTX/Dockerfile.serve"
cp "$ROOT/railway.toml" "$CTX/railway.toml"

# Patches
rsync -a --delete "$ROOT/patches/" "$CTX/patches/"

# Package manifests only (for bun install layer)
for pkg in "${PACKAGES[@]}"; do
  cp "$ROOT/$pkg/package.json" "$CTX/$pkg/package.json"
done

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

for pkg in "${PACKAGES[@]}"; do
  rsync "${RSYNC_OPTS[@]}" "$ROOT/$pkg/" "$CTX/$pkg/"
done

# Preflight: a missing context path fails the Railway build minutes later with a
# bare "failed to compute cache key", and the CI deploy step runs --detach so it
# never sees that error. Catch it here instead.
missing=""
while IFS= read -r src; do
  [ -e "$CTX/$src" ] || missing="$missing    $src
"
done < <(context_copy_sources)

if [ -n "$missing" ]; then
  echo "✗ Build context is missing paths Dockerfile.serve copies:"
  printf '%s' "$missing"
  exit 1
fi

echo "✓ Context satisfies every COPY in Dockerfile.serve ($(du -sh "$CTX" | cut -f1))"

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
