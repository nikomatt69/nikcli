# @nikcli-ai/computer-use

Control, inspect, capture and test real desktop sessions through a background
per-workspace daemon, the way `@nikcli-ai/browser-control` drives a headless
Chromium page or `@nikcli-ai/terminal-control` drives a PTY-backed TUI. Spawn
one or more named sessions (each backed by a Docker-managed Linux desktop in
the default `sandbox` mode, or by the user's real desktop in opt-in `host`
mode), drive them with mouse / keyboard actions, capture screenshots, record
markers, and produce a PR-ready evidence bundle.

For agent-driven desktop verification, the package ships a `computer-use`
evidence CLI and a bundled skill (`skills/computer-use/SKILL.md`) that nikcli
discovers automatically once installed.

## Architecture

Mirrors the `@nikcli-ai/browser-control` layout so any agent habit trained on
the browser skill transfers directly:

```
src/
  index.ts            # public API
  cli.ts              # computer-use CLI (install-skill, bundle)
  session.ts          # ComputerSession — one desktop
  manager.ts          # SessionManager — registry of named sessions
  daemon.ts           # background Unix-socket HTTP server
  daemon-client.ts    # RPC client (spawn-on-first-use)
  frame.ts            # ComputerFrame — screenshot + screen info
  recording.ts        # Recorder — markers + sampled screenshots
  keys.ts             # translateKey / translateKeys
  backends/
    host.ts           # host backend (real desktop, macOS/Linux/Windows)
    sandbox.ts        # sandbox backend (docker exec against a Linux desktop)
    index.ts          # backend(mode, sessionID) selector
  sandbox.ts          # Docker container lifecycle
  sandbox-image.ts    # embedded Dockerfile + entrypoint (content-addressed tag)
  render/
    index.ts          # renderString dispatch
    json.ts           # JSON serialization
    text.ts           # accessibility/text rendering (passthrough)
    png.ts            # PNG bytes (passthrough)
    video.ts          # ffmpeg-based video/gif export
  evidence.ts         # PR evidence bundle

skills/
  computer-use/
    SKILL.md          # agent-facing skill body
    agents/openai.yaml
```

The background daemon self-terminates after `IDLE_SHUTDOWN_MS` with zero
running sessions, the same idle-shutdown contract as `@nikcli-ai/browser-control`.

## Usage

```ts
import { SessionManager, renderText, renderPng } from "@nikcli-ai/computer-use"

const manager = new SessionManager()

// Start a sandbox desktop session for this conversation.
await manager.start({ name: "top", mode: "sandbox", width: 1280, height: 800 })

// Drive the desktop: take a screenshot, click somewhere, type, screenshot again.
const before = await manager.snapshot("top")
await manager.click("top", { x: 320, y: 200 })
await manager.type("top", "hello world")
await manager.key("top", "Return")
const after = await manager.snapshot("top")

// Recording + markers, then evidence bundle.
await manager.startRecording("top", { sampleFps: 4 })
const m = await manager.marker("top", "after-input")
const data = await manager.stopRecording("top")
await manager.stop("top")
```

## API surface

- `SessionManager` — `start / list / info / get / stop / remove / restart /
closeAll`, plus driving: `screenshot / screenSize / moveMouse / click /
drag / type / key / scroll`, plus recording: `startRecording / marker /
stopRecording / recordingData`.
- `ComputerSession` — single desktop: `info() / isRunning() / screenshot() /
screenSize() / moveMouse() / click() / drag() / type() / key() / scroll() /
startRecording() / marker() / stopRecording() / recordingData() / stop()`.
- `renderText / renderJSON / renderPng / exportVideo / createGifPreview` and
  the `renderString(frame, format)` dispatcher.
- `createEvidenceBundle(...)` — turn a screenshot (or recording-derived
  frame) into a PR artifact directory with manifest, GIF preview, MP4 and
  PR Markdown.
- `ensureDaemon / rpc / shutdownDaemon / socketPathFor` — the background
  daemon's RPC surface, mirroring browser-control.

## Backends

- `sandbox` (default) — drives a per-session isolated Linux desktop container
  via `docker exec`; the host screen is never touched. Needs a reachable
  container runtime (`docker`, or set `NIKCLI_COMPUTER_RUNTIME`). On macOS
  start it with colima (already a lightweight Linux VM):
  ```bash
  colima start --cpu 4 --memory 6 --disk 30
  ```
- `host` — drives the user's real desktop in real time (screencapture +
  System Events on macOS, xdotool + scrot/import on Linux, PowerShell +
  SendKeys on Windows). Only opt-in.

## CLI

```bash
computer-use start [--name NAME] [--mode sandbox|host] [--width N] [--height N]
computer-use list
computer-use info NAME
computer-use capabilities NAME
computer-use screenshot NAME [--out FILE]
computer-use click NAME X Y [--button left|right|middle] [--double]
computer-use type NAME TEXT
computer-use key NAME COMBO
computer-use drag NAME FROM_X FROM_Y TO_X TO_Y
computer-use scroll NAME X Y DIRECTION [--amount N]
computer-use start-recording NAME [--fps N]
computer-use marker NAME LABEL
computer-use stop-recording NAME
computer-use stop NAME
computer-use remove NAME
computer-use close-all
computer-use bundle [--screenshot FILE | --recording FILE] --out DIR --result passed|failed|unverified [...]
computer-use install-skill [--workspace DIR | --global]
```
