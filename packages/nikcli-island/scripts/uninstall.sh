#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/Applications/NikcliIsland.app"
SUPPORT_DIR="$HOME/Library/Application Support/NikcliIsland"

echo "==> Quitting NikcliIsland if running"
osascript -e 'tell application id "com.nikcli.island" to quit' >/dev/null 2>&1 || true

echo "==> Removing $APP_DIR"
rm -rf "$APP_DIR"

echo "==> Removing state directory $SUPPORT_DIR"
rm -rf "$SUPPORT_DIR"

echo "Done. The nikcli CLI bridge (packages/nikcli/src/plugin/island/bridge.ts) is still"
echo "wired in but writes are cheap no-ops once nothing reads them; set"
echo "NIKCLI_ISLAND_DISABLE=1 in your environment to skip it entirely."
