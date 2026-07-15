# NikcliIsland

A Dynamic-Island-style status HUD for the macOS notch, showing the live status of
`nikcli` sessions running on this machine — modeled on [Pookify](https://github.com/eyadhammouda/pookify)
(the equivalent for Claude Code), rebuilt around nikcli's own event bus instead of a
hook file.

## Why this isn't just Pookify with different colors

Claude Code only exposes lifecycle hooks that shell out to an external command with a
one-way JSON blob on stdin. Pookify has to reconstruct session liveness, turn timing,
and even interruption detection (by tailing the transcript file) from that alone — real
engineering, but forced by a one-way channel.

nikcli doesn't have that constraint: it already has a live, in-process event bus
(`session.status`, `permission.asked` / `permission.replied`, `message.part.updated`,
`session.error`, ...) and a local HTTP API. So the bridge here is CLI-level, not a
compiled hook helper:

- **`packages/nikcli/src/plugin/island/bridge.ts`** — started unconditionally from
  `src/index.ts`'s top-level middleware (so it runs for _any_ nikcli invocation: `nikcli
tui`, a one-shot `nikcli run`, `nikcli serve` — not just the TUI). It listens on
  `GlobalBus` (`src/bus/global.ts`), which every `Bus.publish(...)` call already forwards
  to regardless of mode, and mirrors each session's state into a small JSON file per
  session under `~/Library/Application Support/NikcliIsland/state.d/`.
- **This Swift package** reads those files (`SessionAggregator.swift`, ported from
  Pookify's file-polling design almost unchanged — that part _is_ agent-agnostic) and
  draws the notch (`IslandView.swift`, `NotchWindow.swift`, `IslandShape.swift`,
  `NSScreen+Notch.swift` — all reused from Pookify essentially verbatim, since window/
  shape/animation code has nothing agent-specific in it).
- Each snapshot also carries the writing process's local server port. Because that's a
  _live_ nikcli process with a real HTTP API — not a one-way hook — the island can POST
  straight to `/permission/:requestID/reply` to **approve or deny a permission request
  from the notch**. Pookify can only ever display Claude Code's permission state; it has
  no channel back into the agent.

## Layout

```
Sources/
  IslandCore/           shared types + the on-disk snapshot schema (read side; a
                         write() exists too, for parity/local testing without a
                         running nikcli process — production writes come from bridge.ts)
  NikcliIsland/          the notch app: polling, aggregation, SwiftUI rendering,
                         permission reply
scripts/
  install.sh             swift build -c release, assemble NikcliIsland.app, install
                         to /Applications
  uninstall.sh
```

There is no `island-hook` executable target (Pookify's compiled hook helper) — nothing
to install into `~/.claude/settings.json` or equivalent, because nikcli's CLI process
writes the state files itself.

## Build & install

```bash
./scripts/install.sh
```

Start nikcli with `--island` to enable the bridge for that invocation; the app wakes
itself (`open -g -b com.nikcli.island`) the first time a session does anything. The
bridge is disabled by default. Set `NIKCLI_ISLAND_DISABLE=1` in your environment to
force it off even when the flag is present.

## Visual design

The pill mechanics (closed slim bar hugging the notch, tap-to-expand growing downward,
the session stack for 2+ live sessions) are carried over from Pookify's already-tuned
implementation. The identity glyph is new — a procedural SF Symbol mark instead of baked
pixel-art frames, since there's no bitmap asset to source for nikcli yet. If you have
a specific look in mind (e.g. matching a particular reference video), the glyph and
`Theme.swift`'s accent/pill colors are the two places to point that at.
