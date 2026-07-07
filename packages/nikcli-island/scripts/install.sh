#!/usr/bin/env bash
set -euo pipefail

# Builds NikcliIsland.app and installs it to /Applications. Unlike Pookify's installer,
# there is no hook config to merge — the nikcli CLI itself writes the state files this
# app reads (packages/nikcli/src/plugin/island/bridge.ts), wired in unconditionally at
# CLI startup. This script only has to build and place the app.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="NikcliIsland"
BUNDLE_ID="com.nikcli.island"
BUILD_DIR="$ROOT/.build/release"
APP_DIR="/Applications/$APP_NAME.app"

echo "==> Building $APP_NAME (release)"
swift build --package-path "$ROOT" -c release

echo "==> Assembling $APP_DIR"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
cp "$BUILD_DIR/$APP_NAME" "$APP_DIR/Contents/MacOS/$APP_NAME"
chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

# SwiftPM builds resources (Sources/NikcliIsland/Resources/wordmark.png) into a sibling
# .bundle next to the executable, not into the executable itself. Its generated
# Bundle.module accessor looks for it at Bundle.main.resourceURL first when running
# inside a real .app — i.e. Contents/Resources, NOT next to the binary in Contents/MacOS
# — and *crashes* (fatalError, not a nil/graceful miss) if it isn't there. Verified by
# actually launching a simulated install layout, not just by reading the generated code.
RESOURCE_BUNDLE="$BUILD_DIR/${APP_NAME}_${APP_NAME}.bundle"
mkdir -p "$APP_DIR/Contents/Resources"
if [ -d "$RESOURCE_BUNDLE" ]; then
    cp -R "$RESOURCE_BUNDLE" "$APP_DIR/Contents/Resources/"
else
    echo "error: expected resource bundle not found at $RESOURCE_BUNDLE — the app would crash on launch" >&2
    exit 1
fi

# Finder/Dock-style app icon (assets/AppIcon.icns, the same mark nikcli's desktop
# app ships) — distinct from the in-UI wordmark above: this one is what /Applications,
# Login Items, and Activity Monitor show, even though the app itself has no Dock icon
# of its own at runtime (LSUIElement below).
if [ -f "$ROOT/assets/AppIcon.icns" ]; then
    cp "$ROOT/assets/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
else
    echo "warning: $ROOT/assets/AppIcon.icns not found — the app will use a generic icon" >&2
fi

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundleDisplayName</key><string>$APP_NAME</string>
    <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
    <key>CFBundleExecutable</key><string>$APP_NAME</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>CFBundleIconFile</key><string>AppIcon</string>
</dict>
</plist>
PLIST

# Defensive, not strictly needed for a build placed straight into /Applications by this
# script (a locally built app isn't quarantined, so Gatekeeper trusts it as-is — same
# reasoning Pookify's installer relies on) — but if this repo checkout itself ever picked
# up com.apple.quarantine (a zip download, a cloud-synced folder, etc.), that would
# propagate into the built app too. Strip it and ad-hoc sign so first launch is never
# blocked by Gatekeeper regardless of how the source tree arrived on disk.
xattr -cr "$APP_DIR" 2>/dev/null || true
codesign --force --deep --sign - "$APP_DIR" 2>/dev/null || true

echo "==> Registering with Launch Services"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR" >/dev/null 2>&1 || true

echo
echo "Installed $APP_DIR."
echo
echo "The island wakes itself automatically whenever a nikcli session does anything"
echo "(started at CLI startup in packages/nikcli/src/index.ts — nothing else to configure)."
echo "To start it right now:  open -g -b $BUNDLE_ID"
