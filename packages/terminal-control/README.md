# @nikcli-ai/terminal-control

Control, inspect, capture and test real terminal applications (TUIs) — a
custom-built, dependency-light terminal-control engine for nikcli, inspired by
[kitlangton/terminal-control](https://github.com/kitlangton/terminal-control)
but written in TypeScript/Bun.

It spawns a PTY-backed program, parses its ANSI/VT output into a **screen grid**
(a `Frame` — a 2D array of styled cells via a hand-rolled VT100/xterm emulator),
and renders that frame to **text / ansi / json / svg / png**.

## Usage

```ts
import { SessionManager, renderText, renderSvg } from "@nikcli-ai/terminal-control"

const manager = new SessionManager()

// Start a TUI.
manager.start({ name: "top", command: "top", cols: 100, rows: 30 })

// Wait until it has drawn something recognizable.
await manager.wait("top", { type: "text", value: "PID", timeout: 5000 })

// Capture the rendered screen.
console.log(renderText(manager.snapshot("top")))
const svg = renderSvg(manager.snapshot("top"))

// Drive it, then stop.
manager.send("top", "q", "keys")
manager.stop("top")
```

## API surface

- `SessionManager` — `start / list / get / send / wait / resize / snapshot / text / rawOutput / stop / restart / closeAll` plus recording: `startRecording / marker / stopRecording / recordingData / isRecording`.
- `Session` — a single PTY app: `send(input, "text"|"keys")`, `wait(condition)`, `snapshot()`, `resize()`, `stop()`, `startRecording()`, `marker(name)`, `stopRecording()`.
- `Screen` / `Parser` — the VT emulator (usable standalone to parse any ANSI stream).
- `renderText / renderAnsi / renderJSON / renderSvg / renderPng` and the `renderString(frame, format)` dispatcher.

`wait` conditions: `{ type: "text", value, timeout? }`, `{ type: "stable", ms?, timeout? }`, `{ type: "timeout", ms }`.

PNG rendering uses the optional `@resvg/resvg-js` dependency, imported lazily.

## Recording & video (v2)

Capture a session's output timeline and replay or export it.

```ts
manager.startRecording("top")
manager.marker("top", "after-load")
// ... drive the session ...
const rec = manager.stopRecording("top")! // RecordingData (versioned, serializable)
```

- `frameAt(rec, ms)` / `finalFrame(rec)` — reconstruct the screen at any moment.
- `sampleFrames(rec, { fps })` — evenly spaced frames (incremental replay, O(events + frames)).
- `clipBetweenMarkers(rec, "a", "b")` / `clip(rec, from, to)` — extract a sub-recording.
- `toAsciicast(rec)` — export to the standard **asciinema v2** cast format.
- `renderAnimatedSvg(rec, { fps, speed })` — a **self-contained animated SVG** (zero dependencies).
- `renderPngSequence(rec, { fps })` — a sequence of PNG frames (needs `@resvg/resvg-js`).
- `exportVideo(rec, { format: "mp4" | "gif", outPath, fps, speed })` — assembled via the
  `ffmpeg` binary if present; `ffmpegAvailable()` reports availability (falls back to `svganim`).

## Scope

Full session/frame/render core **and** v2 timeline recording, replay, asciicast,
animated SVG, PNG-sequence and ffmpeg-based mp4/gif export.
