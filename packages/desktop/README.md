# Nikcli Desktop

Native Nikcli desktop app, built with Tauri v2.

## Development

From the repo root:

```bash
bun install
bun run desktop:dev
```

This builds the current-platform nikcli sidecar, starts the Vite WebGUI on http://localhost:1420,
and opens it in the native Tauri window.

If you only want the shared WebGUI (no native shell):

```bash
bun run webgui:dev
```

The shared WebGUI connects to a nikcli server. Start one separately when needed:

```bash
bun run --cwd packages/nikcli dev serve --hostname 127.0.0.1 --port 4096
```

## Build

To create a production `dist/` and build the native app bundle:

```bash
bun run desktop:build
```

The build command uses `src-tauri/tauri.prod.conf.json`, prepares the bundled CLI sidecar from the
current source tree, enables updater artifacts, and uses the production application icons.

## Installing a downloaded release

The published builds are **not signed with a paid Apple/Windows certificate**, so the OS shows a
one-time warning on a freshly downloaded app. This is expected — the app is safe to run.

- **macOS** — the bundle is ad-hoc signed but not notarized. On first launch, **right-click
  (Control-click) the app → Open → Open** to confirm. If macOS still says the app is "damaged",
  clear the download quarantine flag once:

  ```bash
  xattr -dr com.apple.quarantine /Applications/Nikcli.app
  ```

- **Windows** — if SmartScreen shows "Windows protected your PC", click **More info → Run anyway**.

- **Linux** — install the downloaded `.deb` or `.rpm` package directly; no extra step is required.

## Prerequisites

Running the desktop app requires additional Tauri dependencies (Rust toolchain, platform-specific libraries). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup instructions.
