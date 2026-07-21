# Native UI — OS-native generative dialogs (v1)

nikcli can already assemble a streaming interface in the terminal (see
`specs/generative-tui.md`). This spec extends that engine to **OS-native
surfaces**: the model emits a dialog spec, and a small native shell renders it
as a real popover/panel — updating in realtime as the spec streams, with
button actions flowing back into the session.

**v1 platform scope (decided 2026-07-22): macOS + Linux, in that priority.
Windows later.** The protocol is cross-platform from day one; only the shells
are per-OS. When no shell is attached, the same tool call renders through the
existing TUI generative renderer (and later web) — the model never branches on
platform.

## Why this is cheap here

Three things already exist and are reused, not rebuilt:

1. **Catalog / registry split** (`specs/generative-tui.md`) — the viz catalog
   (`src/tool/opentui.ts`, `VizCatalog`, `VIZ_COMPONENT_TYPES`) is deliberately
   separate from the renderer registry. A native shell is *just another
   registry* for (a subset of) the same catalog.
2. **Streaming compiler** (`src/cli/cmd/tui/util/spec-stream.ts`) — turns
   half-finished model output into render-safe, versioned snapshots and only
   bumps `version` when the render-safe projection changes. That is exactly the
   re-render gate a native window needs to not flicker.
3. **A proven native round-trip** (`packages/nikcli-island` +
   `src/plugin/island/bridge.ts`) — atomic per-session JSON snapshots on disk,
   polled by a native app that can POST back into the local server
   (`/permission/:requestID/reply`). Native dialogs use the same file contract
   for display and the same HTTP callback pattern for actions.

## Architecture

```
model ──(native_dialog tool)──► spec-stream compiler ──► DialogBridge
                                                            │ atomic JSON snapshots
                                                            ▼
                                            <state dir>/dialogs.d/<sessionID>.json
                                                            │ poll (island cadence)
                        ┌───────────────────────────────────┼──────────────────────┐
                        ▼                                   ▼                      ▼
              NikcliIsland (SwiftUI)             nikcli-shell-gtk (GTK4)     TUI fallback
                        │                                   │              (existing viz
                        └────────── POST /native-ui/:dialogID/action ────┐  renderer)
                                                                         ▼
                                                     resolves the pending tool call
```

### 1. Catalog: the dialog envelope (platform-agnostic)

New module `src/tool/native-ui.ts`, Effect Schema like `opentui.ts`:

```ts
NativeDialogSpec = {
  id: string             // dialog ID (one active dialog per session in v1)
  sessionID: string
  title: string
  level: "info" | "progress" | "ask"   // shells may style/persist differently
  components: NativeComponent[]        // v1 subset of the viz catalog
  actions: Action[]                    // empty = display-only, non-blocking
  version: number                      // spec-stream version, re-render gate
}
Action = { id: string, label: string, style: "default" | "primary" | "destructive" }
```

`NativeComponent` is a **v1 subset of `VIZ_COMPONENT_TYPES`** — `text`,
`markdown`, `card`, `list`, `table`, `progress`, `gauge` — validated by the
same `decodeVizComponent` tolerance pipeline (deepUnwrap, render-safe
filtering). Shells that don't know a type render the muted
`⚠ <type> unavailable` placeholder, mirroring the TUI's `ErrorBoundary`
degradation, so the catalog can grow without lockstep shell releases.

Non-goals in v1: nested `section`/`grid` layout, free-form text inputs
(actions are buttons only), multiple concurrent dialogs per session, Windows.

### 2. Bridge: generalize the island file contract

`src/plugin/island/bridge.ts` is macOS-only by design (the notch app is). For
dialogs, the state-dir resolution generalizes per-OS instead:

- macOS: `~/Library/Application Support/NikcliIsland/dialogs.d/`
  (sibling of the existing `state.d/`, same atomic temp-file+rename writes,
  same self-activating `Bus.publish` hook, same `stop()` contract)
- Linux: `${XDG_STATE_HOME:-~/.local/state}/nikcli-shell/dialogs.d/`

Each snapshot carries `port` (the writing process's local server URL) exactly
like the island snapshots do — that is how a shell knows where to POST
actions. Written only on `version` bump.

### 3. Transport: routes (`src/server/routes/native-ui.ts`)

Hono routes, mirroring `routes/question.ts` (see
`project_http_routes_hono`— real routes live in Hono, not the Effect
PublicHttpApi):

- `GET  /native-ui/dialogs` — list active dialogs (debug + shell catch-up)
- `POST /native-ui/:dialogID/action` — body `{ actionID }`; publishes
  `native-ui.action` on the bus, which resolves the pending tool call. Same
  shape as the permission/question reply flow.

File polling is the v1 push channel on both platforms (proven by the island;
zero connection lifecycle to manage). SSE subscription is a v1.1 upgrade, not
a v1 requirement.

### 4. Tool surface: `native_dialog`

`Tool.define("native_dialog", …)` next to the `opentui` viz tool:

- Params = the dialog envelope (minus `id`/`sessionID`/`version`, which the
  tool assigns).
- `level: "ask"` (has `actions`) → **blocking**: the call resolves when a shell
  POSTs an action, with a timeout that resolves to a declared default action —
  so a headless/unattended run never hangs.
- `level: "info" | "progress"` → fire-and-forget; subsequent calls with the
  same dialog `id` update it in place (streamed via the compiler, so a
  progress dialog assembles/updates live).
- **Fallback**: if no shell has polled the state dir recently (heartbeat file
  touched by shells on each poll), the tool renders the same spec through the
  existing TUI renderer (`dialog-opentui-viz.tsx`) instead. Identical tool API
  either way.

### 5. Shells

**macOS — extend `packages/nikcli-island` (P2).** A SwiftUI registry for the
v1 component subset, shown in an `NSPanel` anchored under the notch pill
(reusing `NotchWindow` mechanics). Buttons POST to
`/native-ui/:dialogID/action` exactly like the existing permission reply.
Dialog polling joins the existing `SessionAggregator` poll loop.

**Linux — new `packages/nikcli-shell-gtk` (P3).** A small GTK4 helper (Rust +
`gtk4-rs`; the repo already carries a Rust toolchain for the Tauri desktop)
implementing the same contract: poll `dialogs.d/`, render the subset with
GTK4 widgets in a popover-style always-on-top window, POST actions, touch the
heartbeat. `level: "info"` with no actions may additionally emit a libnotify
notification. Packaged like `nikcli-island` (private package, install script,
not part of the JS build graph).

**Windows — deferred.** The protocol needs nothing new; a WinUI or
Tauri-webview shell slots in later.

## Phases

- **P1 — protocol, no native code**: catalog subset + envelope
  (`src/tool/native-ui.ts`), dialog bridge writes, routes, `native_dialog`
  tool with TUI fallback + timeout defaults. Ships alone: works on every OS
  today via the fallback, and defines the complete contract shells target.
- **P2 — macOS shell**: SwiftUI registry + panel + action POST in
  `nikcli-island`.
- **P3 — Linux shell**: `nikcli-shell-gtk`.
- **P4 — later**: SSE push channel, web/desktop (Solid registry via
  `@json-render/solid` in the Tauri app), Windows shell, text-input actions,
  multi-dialog.

## Testing

- P1 is fully testable with bun tests: envelope validation (reusing the
  opentui tolerance suite patterns), bridge write/version-gating (with the
  per-file `NIKCLI_TEST_HOME` / state-dir override convention `bridge.ts`
  already follows), route round-trip, tool blocking/timeout/fallback.
- `packages/simulation` can drive the tool end-to-end headless (fallback
  path) via `NIKCLI_DRIVE`.
- Shell rendering is verified manually per-OS (macOS notch panel; GTK popover
  on a Linux box/VM).
