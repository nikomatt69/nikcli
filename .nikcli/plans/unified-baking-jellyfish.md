# Plan: Terminal Control for nikcli (custom pkg + tool)

## Context

The user wants to recreate kitlangton's [`terminal-control`](https://github.com/kitlangton/terminal-control)
inside nikcli — the ability to **control, inspect, capture and test real terminal
applications (TUIs)** programmatically, so an agent can drive a TUI and read its
rendered screen state.

The upstream project is **Rust**. nikcli is **TypeScript/Bun**, so we re-implement
the concept *su misura* (custom-built) in TS. We already have most of the substrate:
- `packages/nikcli/src/pty/index.ts` — a `bun-pty`-backed PTY service (spawn, write, resize, buffer, events).
- `bun-pty@0.4.4` and `strip-ansi@7.1.2` are already dependencies.
- A clean tool system (`Tool.define`) and registry (`packages/nikcli/src/tool/registry.ts`).

What's **missing** and is the heart of terminal-control: a **VT/ANSI emulator** that
turns a raw PTY byte stream into a *screen grid* (a "Frame" — a 2D array of styled
cells), plus **renderers** (text / ansi / json / svg / png) and a **named-session
manager** that keeps TUIs alive across calls.

**Decisions confirmed with user:**
- VT engine: **custom hand-rolled** TS emulator (no heavy emulator dependency).
- Output formats: **all** like upstream — `text`, `ansi`, `json`, `svg`, `png`.
- Scope v1: **full core** (session lifecycle + frame + render + nikcli tool). Recording/video deferred to v2.

**Outcome:** a reusable `@nikcli-ai/terminal-control` package + a `terminal_control`
nikcli tool the model can call exactly like `bash`, `read`, etc.

---

## Part A — New package `@nikcli-ai/terminal-control`

Framework-agnostic library (no Effect dependency) so it stays reusable and testable.
Location: `packages/terminal-control/`.

### A.1 Package scaffolding
- `packages/terminal-control/package.json` — mirror `packages/util/package.json`:
  - `name: "@nikcli-ai/terminal-control"`, `version: "1.42.0"`, `private: true`, `type: module`,
    `exports: { "./*": "./src/*.ts" }`, `scripts.typecheck: "tsc --noEmit"`.
  - deps: `bun-pty` (same `0.4.4` as nikcli), `strip-ansi` (`catalog:`/`7.1.2`).
  - PNG renderer dep `@resvg/resvg-js` added here, **imported lazily** (only when png requested) so it never costs startup.
  - devDeps: `typescript: catalog:`, `@types/bun: catalog:`.
- `packages/terminal-control/tsconfig.json` — copy `packages/util/tsconfig.json` (strict, bundler, noEmit).
- `packages/terminal-control/README.md` — short usage doc.
- Add `"@nikcli-ai/terminal-control": "workspace:*"` to `packages/nikcli/package.json` dependencies.
  (Workspace globs in root `package.json` already include `packages/*`, so no root change needed.)

### A.2 Core source layout (`packages/terminal-control/src/`)

```
index.ts            Public barrel — re-exports Frame, Screen, Session, SessionManager, render
frame.ts            Cell / Attributes / Frame types + factory + diff helper
vt/
  color.ts          16-color + 256-color palette + truecolor; default fg/bg
  sgr.ts            SGR (CSI ... m) param list -> Attributes mutations (bold/italic/underline/inverse/fg/bg/reset)
  parser.ts         Byte/string -> events state machine (ground, ESC, CSI, OSC). Emits print + control ops.
  screen.ts         Screen emulator: grid, cursor, scroll region, tab stops; consumes parser events
session.ts          Session: bun-pty lifecycle + feeds Screen; snapshot() -> Frame; wait conditions
manager.ts          SessionManager: Map<name, Session>; start/get/list/stop/restart/send/resize/snapshot
render/
  text.ts           Frame -> plain text (trim trailing blanks)
  ansi.ts           Frame -> ANSI string (re-emit SGR from cell attrs)
  json.ts           Frame -> structured JSON (rows of cells, cursor, size)
  svg.ts            Frame -> SVG (monospace <text> spans + bg <rect>s; pure string, no deps)
  png.ts            Frame -> PNG (render svg.ts output, rasterize via lazy @resvg/resvg-js)
  index.ts          render(frame, format) dispatcher + Format union type
```

### A.3 Key design notes
- **`frame.ts`**: `Cell = { char: string; fg: Color; bg: Color; bold; italic; underline; inverse }`.
  `Frame = { cols; rows; cursor: {x,y,visible}; cells: Cell[][]; title?: string }`. Provide `blankCell()`, `emptyFrame(cols,rows)`.
- **`vt/parser.ts`**: focused VT100/xterm state machine covering the common TUI subset:
  printable runs, `BEL/BS/HT/LF/CR`, `CSI` sequences (CUU/CUD/CUF/CUB `A–D`, CUP/HVP `H/f`,
  ED `J`, EL `K`, SGR `m`, scroll `r`/`S`/`T`, cursor show/hide `?25h/l`, save/restore),
  `OSC 0/2` (window title). Unknown sequences are consumed and ignored (never throw) — robustness over completeness.
- **`vt/screen.ts`**: applies events to the grid; handles autowrap, LF scroll within region,
  erase semantics, cursor clamping. This is the most logic-heavy file; covered by unit tests (A.4).
- **`session.ts`**: wraps `spawn` from `bun-pty` (same options as `Pty.create`:
  `name: "xterm-256color"`, env `TERM=xterm-256color`, `NIKCLI_TERMINAL=1`). On `onData`,
  feed bytes to both the `Screen` and a bounded raw log buffer (reuse the 2MB cap idea from `pty/index.ts`).
  - `send(input, { mode })` — `mode: "text" | "keys"`; a small **key-name → escape** map
    (`enter`, `tab`, `esc`, `up/down/left/right`, `ctrl+c`, `backspace`, `space`, …).
  - `snapshot()` -> current `Frame`. `wait({ until })`:
    `until: { type:"text", value } | { type:"stable", ms } | { type:"timeout", ms }`
    (stable = no new output for `ms`). Returns the frame at satisfaction.
  - `resize(cols, rows)` resizes both pty and screen. `stop()` kills the process.
- **`manager.ts`**: in-memory `Map`. Pure class; the Effect lifecycle/singleton lives in nikcli (Part B).

### A.4 Tests (`packages/terminal-control/test/`, `bun test`)
- `screen.test.ts` — feed canonical sequences, assert grid/cursor (CUP, ED/EL, SGR colors, autowrap, scroll).
- `render.test.ts` — round-trip a known frame to text/ansi/json; assert SVG contains expected glyphs.
- `session.test.ts` — start `printf`/`echo`, `wait` for text, `snapshot`, assert content; `stop`.

---

## Part B — nikcli integration

### B.1 Effect service wrapper — `packages/nikcli/src/terminal/index.ts`
Mirror `packages/nikcli/src/pty/index.ts` exactly (the proven pattern):
- `namespace Terminal` with `class Service extends Context.Service<...>()("@nikcli/Terminal")`.
- `layer = Layer.effect(Service, ...)` using `InstanceState.make` to hold one
  `SessionManager` per instance (so sessions persist across tool calls; auto-cleaned on release like `closeSessions`).
- Interface methods delegate to the library: `start`, `list`, `get`, `send`, `wait`,
  `resize`, `snapshot(name, format)`, `stop`, `restart`, `logs`.
- `export const defaultLayer = layer`.

### B.2 The tool — `packages/nikcli/src/tool/terminal_control.ts` (+ `.txt`)
Follow `Tool.define` + Effect-service-call convention used in `server/routes/pty.ts`:
`runPromiseWithLayer(Terminal.defaultLayer, withCurrentInstance(effect))`.

- **Parameters** (zod via `effect-zod` like `bash.ts`): single `action` discriminator:
  - `start` — `{ name?, command, args?, cwd?, cols?, rows?, title? }` → starts/returns session info.
  - `send` — `{ name, input, mode?: "text"|"keys" }` → sends to the TUI.
  - `capture` — `{ name, format?: "text"|"ansi"|"json"|"svg"|"png" }` → renders current frame.
    For `png`/`svg`, write the artifact under `.nikcli/` and return it as a
    `MessageV2.FilePart` attachment (Tool.Result supports `attachments`); `text/ansi/json` go in `output`.
  - `wait` — `{ name, until: "text"|"stable"|"timeout", value?, timeout? }` → returns frame after condition.
  - `resize` — `{ name, cols, rows }`.
  - `list` — all sessions. `stop` / `restart` — `{ name }`. `logs` — `{ name, lines? }` raw buffer.
- Respect `ctx.abort`; emit live `ctx.metadata({ ... })` (current text frame) like `bash.ts` does for `output`.
- Gate `start` behind a permission `ctx.ask({ permission: "bash", patterns: [command...], ... })`
  reusing the spirit of `authorizeBashCommand` (spawning a process needs the same trust as bash).
- `description` loaded from `terminal_control.txt` (concise usage like other `.txt` files).

### B.3 Register the tool — `packages/nikcli/src/tool/registry.ts`
- `import { TerminalControlTool } from "./terminal_control"`.
- Add `TerminalControlTool` to the `all()` array (near `BashTool`/`MonitorTool`).
- (Not added to `SLIM_TOOLS` — it's a specialized tool, discoverable via `search_tools`.)

### B.4 (Optional, low-cost) server route
Not required for the tool to work. Skip in v1 unless desired; the tool path is self-contained.

---

## Critical files
- **New:** `packages/terminal-control/{package.json,tsconfig.json,README.md}` and all of `src/**` + `test/**` above.
- **New:** `packages/nikcli/src/terminal/index.ts`, `packages/nikcli/src/tool/terminal_control.ts`, `packages/nikcli/src/tool/terminal_control.txt`.
- **Edit:** `packages/nikcli/src/tool/registry.ts` (import + add to `all()`).
- **Edit:** `packages/nikcli/package.json` (add `@nikcli-ai/terminal-control` workspace dep).

## Reuse (don't reinvent)
- `bun-pty` spawn + env setup — copy the recipe from `packages/nikcli/src/pty/index.ts:122-156`.
- Tool shape & live metadata — pattern from `packages/nikcli/src/tool/bash.ts`.
- Service+InstanceState lifecycle — pattern from `packages/nikcli/src/pty/index.ts:102-285`.
- Service-call-from-tool — pattern from `packages/nikcli/src/server/routes/pty.ts:12-14`.
- zod-from-Schema helper — `zod`/`zodObject` from `@/util/effect-zod` (as in `bash.ts`, `pty/index.ts`).

## Verification
1. **Library unit tests:** `cd packages/terminal-control && bun test` — screen/render/session pass.
2. **Typecheck:** `bun run typecheck` in `packages/terminal-control` and `packages/nikcli`
   (per memory: nikcli uses `bun run typecheck` → `tsgo`).
3. **Tool registration:** confirm `terminal_control` appears in `ToolRegistry.ids()` (quick script or `search_tools`).
4. **End-to-end manual:** via nikcli, call `terminal_control` → `start` a small TUI (e.g. `htop`/`vim`/`top`),
   `wait` for known text, `capture` as `text` (assert rendered screen), `capture` as `png`
   (assert attachment written under `.nikcli/`), `send` a key (e.g. `q`), `stop`. Verify session
   survives across the separate tool calls.
