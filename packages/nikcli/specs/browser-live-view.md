# Browser live view — a real Chromium page inside the TUI

Today `dialog-web-preview.tsx` is a _reader_: it `fetch`es a URL, strips the HTML
with regexes, runs Turndown over it and renders markdown. No JavaScript runs, no
layout happens, nothing is clickable. This spec describes replacing that with a
real browser surface — pixels from a live Chromium page, composited into the
OpenTUI grid, with mouse and keyboard forwarded back into the page.

The reference implementation is [neriousy/opencode-browser](https://github.com/neriousy/opencode-browser)
and its rendering library [`opentui-browser`](https://www.npmjs.com/package/opentui-browser).
This document explains what those actually do, why nikcli cannot consume them
directly, and how the same result is assembled out of packages nikcli already
owns.

---

## 1. What the reference implementation actually does

The plugin repo is mostly plumbing (MCP registration, a loopback control server,
tab-strip UI). The interesting 20% lives in `opentui-browser`:

| Concern         | How `opentui-browser` does it                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser process | Its own minimal CDP client (`cdp.ts`) + Chrome launcher (`chromium.ts`) — temp profile, DevTools bound to loopback. No Playwright/Puppeteer.                                                                                  |
| Frame source    | **`Page.startScreencast`** (CDP). Chromium _pushes_ a PNG whenever the page changes; each frame is acked with `Page.screencastFrameAck`. Not screenshot polling.                                                              |
| Frame transport | Kitty graphics, and by default **`t=t` (temporary file)** rather than inline base64: the PNG is written to a temp file and only the _path_ crosses the PTY. The terminal reads and deletes the file itself.                   |
| Placement       | Classic cursor-addressed placements with an explicit `column/row/columns/rows/zIndex`, moved with `a=p` and torn down with `a=d`.                                                                                             |
| Backpressure    | `KittyGraphicsTransport` serializes writes and keeps **at most one** queued frame; a newer frame resolves the older one as `dropped`. An in-flight write is never interrupted.                                                |
| Input           | `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText` with a real modifier bitmask, virtual key codes, click counts and pressed-button tracking. Cell coordinates → page pixels via the terminal's pixel resolution. |
| Terminal gating | `inspectBrowserTerminal()` / `waitForBrowserTerminalSupport()` refuse to start on terminals that can't do it, and say why.                                                                                                    |

The plugin layer around it adds: a shared page reused across sessions, a
loopback HTTP control server (random bearer token, `show`/`open`/`hide`/`status`),
two MCP servers so the _agent_ can drive the same page, and a tab in the content
area rather than a dialog.

## 2. Why we still don't just install it

`opentui-browser@0.1.0` declares `peerDependencies: { "@opentui/core": "^0.4.5" }`.
As of 2026-08-01 nikcli pins `@opentui/core` and `@opentui/solid` at **0.4.5**
(`packages/nikcli/package.json`), so that peer range is now satisfied — the
version gap this section originally described is closed.

What remains is a design objection, not a version one. `BrowserRenderable` extends
`BoxRenderable` and reaches into renderer internals, and the plugin layer around it
duplicates capabilities nikcli already owns (see §3): a driven Chromium with a
session lifecycle, Kitty/Sixel/iTerm2 encoding, and proven pixel compositing into
the OpenTUI grid. Consuming the library would mean running a _second_ CDP client
and Chrome launcher next to `packages/browser-control`. So the build-out below
still assembles the same result from packages already in the tree.

Historical note on the upgrade itself: OpenTUI **0.1.97** introduced a regression
where streamed assistant replies never reached the screen (bisected with
`packages/simulation/test/e2e.test.ts`, which drives the real TUI headless;
reproduced on 0.1.97 → 0.4.5). See `specs/opentui-0.4-upgrade.md` for the
diagnosis and the fixes that unblocked the move to 0.4.5.

## 3. What nikcli already has

The gap is smaller than it looks, because three of the four hard parts are
already in the monorepo:

| Need                                                                      | Already in tree                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A real Chromium, driven, with a session lifecycle and a background daemon | `packages/browser-control` — Playwright Chromium, `BrowserSession`/`SessionManager`, a Unix-socket daemon (`daemon.ts`), and a client (`daemon-client.ts`). Already powers the `browser` tool and `/browser`. |
| Kitty / Sixel / iTerm2 encoding, capability detection, halfblock fallback | `packages/tui-image` — `encodeKittyVirtual`, `kittyPlaceholderGrid`, `kittyIdColor`, `detectCapabilities`, `applyLiveCapabilities`, `supportsKittyUnicodePlaceholders`, `renderImage`.                        |
| Proof that pixels can be composited into the OpenTUI grid                 | `component/tui-image.tsx` — virtual placements, drawless transmission, native-overlay hook for Sixel/iTerm2.                                                                                                  |
| Terminal cell pixel size                                                  | `CliRenderer.resolution: PixelResolution \| null` (present in 0.4.5). Cell size = `resolution.width / terminalWidth`.                                                                                         |

What is missing: a **screencast** path (browser-control captures with
`page.screenshot()`, which is far too slow to run in a loop), **coordinate
input** (browser-control only clicks by CSS selector), and the frame-pump /
placement logic that ties the two together.

## 4. Architecture

Five layers. Layers 1–3 are UI-agnostic and independently testable; only layer 4
knows about Solid.

```
┌───────────────────────────────────────────────────────────────────────┐
│ 5  Mount points                                                        │
│    dialog-web-preview.tsx (live mode)   ·   future: browser route/tab   │
├───────────────────────────────────────────────────────────────────────┤
│ 4  <BrowserSurface>            solid component: geometry, focus,       │
│    component/browser-surface.tsx   chrome (url bar, back/fwd, status)  │
├───────────────────────────────────────────────────────────────────────┤
│ 3  KittyFramePump              image id + placement, frame drop,       │
│    tui/util/browser-frames.ts      geometry diffing, teardown          │
├───────────────────────────────────────────────────────────────────────┤
│ 2  Frame channel               daemon → TUI, one frame = one temp-file │
│    browser-control /screencast     path (or PNG bytes), NDJSON stream  │
├───────────────────────────────────────────────────────────────────────┤
│ 1  Screencast + coordinate input                                       │
│    browser-control/src/screencast.ts, session.ts                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Layer 1 — screencast and coordinate input (`packages/browser-control`)

Playwright exposes raw CDP for Chromium via `context.newCDPSession(page)`, so we
get `Page.startScreencast` without writing a CDP client or a Chrome launcher —
the two largest files in `opentui-browser` (`cdp.ts`, `chromium.ts`) simply do
not need porting.

New in `session.ts`:

```ts
startScreencast(options: ScreencastOptions): AsyncIterable<ScreencastFrame>
stopScreencast(): Promise<void>
```

- `Page.startScreencast({ format: "png", maxWidth, maxHeight, everyNthFrame })`.
  PNG, not JPEG: the Kitty graphics protocol accepts PNG (`f=100`) or raw
  RGB/RGBA, and JPEG would force a decode/re-encode on every frame.
- Each `Page.screencastFrame` is acked immediately with
  `Page.screencastFrameAck` — without the ack Chromium stops sending.
- Frames carry `metadata` (`deviceWidth/Height`, `scrollOffset*`,
  `pageScaleFactor`), which the input layer needs to map cells to page pixels
  once the page is scaled.

Also new, because the live view needs coordinates, not selectors:

```ts
mouse(event: { type: "move" | "down" | "up" | "wheel"; x: number; y: number;
               button?: "left" | "middle" | "right"; clickCount?: number;
               deltaX?: number; deltaY?: number; modifiers?: Modifiers }): Promise<void>
key(event: { type: "down" | "up" | "text"; key?: string; text?: string;
             modifiers?: Modifiers }): Promise<void>
back(): Promise<void>
forward(): Promise<void>
```

Implemented on Playwright's `page.mouse` / `page.keyboard` (which already handle
modifier state and virtual key codes correctly) and `page.goBack/goForward`.
Real history navigation replaces the dialog's current client-side URL stack.

`manager.ts` gains thin delegating methods; `daemon.ts` gains RPC handlers for
`mouse`, `key`, `back`, `forward`.

### Layer 2 — the frame channel

Screencast frames are produced in the daemon process and consumed in the TUI
process. Pushing them through the existing JSON-RPC endpoint would mean
base64 + JSON per frame at up to 24 fps. Instead the daemon grows a streaming
endpoint alongside `/rpc`:

```
GET /screencast?name=<session>&maxWidth=&maxHeight=&fps=
→ text/event-stream, one NDJSON object per frame
```

Two payload modes, negotiated by the client:

| Mode     | Payload                                                                   | When                                                                                                                                            |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`   | `{ path, width, height, seq }` — the daemon writes the PNG to a temp file | Default. Terminal and browser are on the same machine, so the terminal reads the file itself: **the pixels never cross the socket or the PTY.** |
| `inline` | `{ pngBase64, width, height, seq }`                                       | Fallback when the terminal doesn't accept `t=t`, or the daemon is not local.                                                                    |

The `file` mode is the single most important performance decision in this
design. Chromium writes a PNG; the terminal reads that same PNG; nikcli only
ever moves a path string. `opentui-browser` uses the same trick, but it has the
browser in-process — here it additionally removes an IPC copy.

Temp files are written under a per-session directory in `os.tmpdir()`, reaped on
session stop and by the daemon's existing idle-shutdown path. Kitty deletes a
`t=t` file after reading it; the reaper is the safety net for terminals that
don't.

### Layer 3 — `KittyFramePump`

Owns one image id and one placement for the lifetime of the surface.

- **Frame drop.** At most one frame queued behind an in-flight write; a newer
  frame replaces (and resolves as dropped) the older one. Copied wholesale from
  `KittyGraphicsTransport`, because a terminal that falls behind must never
  become a growing backlog.
- **Geometry diffing.** The placeholder cells only change when the surface is
  resized or moved. On a steady stream the grid content is byte-identical
  between frames and only the graphics command is written.
- **Teardown.** `deleteKittyVirtual(id)` on unmount so the terminal frees the
  image.

**Placement flavor: virtual placements (`U=1` + `U+10EEEE` placeholder cells),
not the cursor-addressed placements `opentui-browser` uses.** This is a
deliberate divergence. nikcli already made and documented this call in
`tui-image.tsx`:

> Cursor-addressed protocols (classic kitty, iTerm2, Sixel) are deliberately not
> used here: inside the alternate screen their output lands at the wrong
> position and is clobbered by the next frame.

Virtual placements make the image an ordinary grid citizen — it scrolls,
clips, and repaints with the rest of the TUI, and OpenTUI keeps layout
authority. `t=t` transmission is orthogonal to `U=1` (they are independent keys
in the same APC command), so the temp-file path and virtual placements compose.
_This combination must still be confirmed visually on Ghostty and kitty before
layer 2's `file` mode is made the default_ — see
`script/browser-kitty-smoke.ts`. If a terminal rejects it, the pump falls back
to `inline` with no other change.

The byte-level shape is already verified headlessly (§9): the placeholder grid
is written **once** per placement and every subsequent frame is a single
~430-byte APC command carrying a path, against ~3.4KB/frame for `inline` on a
trivially compressible test page — and `inline` scales with picture complexity
while `t=t` does not.

`tui-image` needs one small addition for this: `encodeKittyVirtualPng(png,
opts)` that transmits **already-encoded PNG bytes**. Today `encodeKittyVirtual`
takes a `PixelImage` and re-encodes — acceptable for a one-shot preview, wasteful
at 24 fps when Chromium already handed us a PNG. `encodeKittyVirtual` becomes a
thin wrapper over it.

### Layer 4 — `<BrowserSurface>`

A Solid component that owns the session and renders the placeholder grid.

- **Geometry.** `renderer.resolution` gives the terminal's pixel size; cell size
  is `resolution.width / terminalWidth` (× height). The surface's cell rectangle
  → a page viewport in pixels → `session.resize(w, h)`, debounced. If
  `resolution` is null (terminal didn't answer), fall back to 10×20 and log it.
- **Input.** `onMouseDown/Up/Move/Scroll` on the box translate `(col,row)` to
  page pixels relative to the surface origin and dispatch through layer 1;
  `useKeyboard` forwards keys while focused, minus the surface's own chords.
- **Chrome.** The existing url bar, `← → ↺`, title and status line from
  `dialog-web-preview.tsx` are kept verbatim — they are good, and they are the
  part that already works.
- **Focus.** While the surface holds focus, keys go to the page. `esc` releases
  focus back to the dialog (so `esc esc` still closes it); `/` focuses the url
  bar. Matches the plugin's `ctrl+l` / `ctrl+shift+b` intent without stealing
  chords nikcli already binds.

### Layer 5 — mount points and fallback

`dialog-web-preview.tsx` picks its mode at mount:

```
supportsKittyUnicodePlaceholders(caps) && daemon reachable && chromium installed
  → live mode   (<BrowserSurface>)
otherwise
  → reader mode (today's fetch + turndown path, unchanged)
```

The reader mode is **not** deleted. It is the correct rendering for a terminal
without graphics, for a page you want to read rather than use, and for the
degraded case where Chromium isn't installed. The mode is also user-switchable
(`r` toggles), because "give me the text" is a legitimate request even on
Ghostty. Sixel/iTerm2 terminals get reader mode in v1: those protocols need the
cursor-positioned overlay hook, which is not safe to drive at video rates.

The surface is a plain component, so mounting it as a route/tab later (the
plugin's model — content area, tab strip, survives session switches) costs
nothing beyond a route registration in `feature-plugins/browser/`.

## 5. Ownership and sharing with the agent

The plugin runs a loopback HTTP server with a bearer token plus two MCP servers
so the agent can drive the displayed page. nikcli needs none of that: the
`browser` tool already talks to the same daemon over the same Unix socket
(`src/browser/browser.ts`), and sessions are already named per conversation
(`nikcli-<sessionID>`). Pointing the live view at the conversation's existing
session name means **the agent and the user are looking at the same page, for
free** — the agent navigates, the user watches it happen.

Caveat to state plainly: this holds when the nikcli server and the TUI run on the
same machine (the default). On a remote-server session the agent's browser
sessions live on the remote host; the live view then uses its own local daemon
and the two are not shared. The dialog surfaces which case it is in.

The daemon's existing 10-minute idle shutdown already covers "user closed the
dialog and forgot about it".

## 6. File-by-file delta

| File                                                                | Change                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/tui-image/src/kitty-placeholder.ts`                       | Add `encodeKittyVirtualPng(png, opts)`; `encodeKittyVirtual` delegates to it. Add `KittyTransmission` support (`t=t`). |
| `packages/browser-control/src/screencast.ts`                        | **New.** CDP screencast over Playwright's `newCDPSession`, ack loop, frame typing.                                     |
| `packages/browser-control/src/session.ts`                           | Add `startScreencast`/`stopScreencast`, `mouse`, `key`, `back`, `forward`.                                             |
| `packages/browser-control/src/manager.ts`                           | Delegating methods for the above.                                                                                      |
| `packages/browser-control/src/daemon.ts`                            | RPC handlers `mouse`/`key`/`back`/`forward`; new `GET /screencast` streaming endpoint + temp-file writer/reaper.       |
| `packages/browser-control/src/daemon-client.ts`                     | `openScreencast(socketPath, params): AsyncIterable<Frame>`.                                                            |
| `packages/nikcli/src/cli/cmd/tui/util/browser-frames.ts`            | **New.** `KittyFramePump` — image/placement lifecycle, frame drop, geometry diffing.                                   |
| `packages/nikcli/src/cli/cmd/tui/component/browser-surface.tsx`     | **New.** The live surface: geometry, input mapping, placeholder grid.                                                  |
| `packages/nikcli/src/cli/cmd/tui/component/dialog-web-preview.tsx`  | Mode selection; keep reader mode intact; wire url bar / nav to real history.                                           |
| `packages/nikcli/src/cli/cmd/tui/feature-plugins/browser/index.tsx` | `/browser <url>` opens the live view directly (matches the plugin's slash-with-argument behavior).                     |

Module-graph hygiene: the TUI must import `@nikcli-ai/browser-control/daemon-client`
(subpath), never the package index — the index re-exports `evidence`/`recording`,
which pull in `@ffmpeg-installer/ffmpeg` and Playwright. The import is also
`await import`ed lazily inside live mode, so a TUI that never opens the browser
never pays for it (see `specs/startup-performance.md`).

## 7. Phases

1. ✅ **Layer 1** — screencast + coordinate input in `browser-control`.
2. ✅ **Layer 2** — daemon streaming endpoint, both payload modes, temp files.
3. ✅ **Kitty encoders** — `encodeKittyVirtualPng` / `encodeKittyVirtualFile`.
4. ✅ **Layer 3** — `BrowserFramePump` (11 unit tests).
5. ✅ **Layer 4** — `BrowserSurface`, mouse/keyboard/geometry.
6. ✅ **Layer 5** — dialog mode switch, reader kept as a peer mode.
7. 🟡 **Visual confirmation** — the byte stream is correct and the wiring
   typechecks and boots, but no automated check can assert that a terminal
   _painted_ it. `script/browser-kitty-smoke.ts` isolates exactly that question.
8. Route/tab mount, if the dialog proves too cramped.

## 10. Keys

Live mode gives almost every key to the page, the way a browser does. The
dialog keeps four chords, ctrl-prefixed so they can't collide with typing:

| Key            | Does                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `esc`          | Not forwarded — it has to reach the dialog, or the dialog can't be closed. |
| `ctrl+l`       | Focus the URL bar.                                                         |
| `ctrl+shift+r` | Toggle live ↔ reader, carrying the current URL across.                     |
| `ctrl+shift+t` | Toggle `t=t` ↔ inline transmission.                                        |

That last one is a diagnostic, not a preference. A terminal that ignores `t=t`
draws _nothing_ and answers no query about it — `q=2` suppresses every
response — so there is no way to detect the case programmatically. Letting a
human flip the switch and see which half works is the only honest fallback, and
it is one keystroke.

Reader mode keeps its original bare-letter keys (`r` reload, `/` url), since
nothing is competing for them there.

## 9. What has been measured

Against a real local Chromium, headless (`bun run typecheck` clean, tui-image
suite 77/77):

| Claim                                                                         | Result                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CDP screencast produces frames through Playwright's `newCDPSession`           | 30 frames in 3s at `maxFps: 10` — the throttle is exact. 640×400 PNGs at ~5.3KB.                                                                        |
| A concurrent RPC does not disturb an in-flight stream on the same Unix socket | 20 frames stream-only, 19 frames with an RPC interleaved per frame.                                                                                     |
| `file` mode writes a real, readable PNG and sends only its path               | 25,347-byte PNG on disk; the NDJSON line carries a 100-byte path.                                                                                       |
| Coordinate input and real history navigation work                             | `pointer`, `key`, `back`, `forward` all round-trip.                                                                                                     |
| PTY cost per frame                                                            | **433 bytes** (`t=t`) vs **3,390 bytes** (`inline`) on a near-blank page; the gap widens with picture complexity, because only `inline` scales with it. |
| The placeholder grid is written once, not per frame                           | 1,840 placeholder cells total for an 80×23 placement across 113 frames.                                                                                 |

Not yet measured, and not measurable from here: whether a terminal _renders_
any of it. That is phase 4.

**A note on `goBack()`.** Playwright resolves it to `null` whenever a
navigation produced no HTTP response — `data:` URLs, same-document entries,
some cache hits — even though the page did move. `BrowserSession.back` therefore
decides by comparing URLs before and after. A back button that reports failure
after successfully going back is worse than not having one.

**A note on silence.** A static page produces no screencast frames at all,
which is correct and indistinguishable downstream from a wedged stream. The
daemon emits a `{"type":"ping"}` line every 15 idle seconds so the connection
stays warm and the client has a liveness signal.

## 8. Non-goals

- Upgrading `@opentui/core` to 0.4.x.
- MCP servers for browser control — the `browser` tool already covers it.
- The plugin's loopback control server and bearer-token handshake — same reason.
- Sixel/iTerm2 at video rates.
- Replacing `packages/webrenderer` (native wry webview). It renders through a
  framebuffer at half-block fidelity and needs a Rust toolchain; it stays the
  right answer for embedding web _content_ nikcli itself authors, not for
  browsing the web.
