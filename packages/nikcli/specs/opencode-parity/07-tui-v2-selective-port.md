# 07 — Selective port from opencode's "TUI v2" commit

Source: `anomalyco/opencode@e6f660f` — _feat(tui): add v2 terminal interface_ (3028+/2035−, 74 files).

## Scope decision

The commit is overwhelmingly opencode's own migration to their **v2 data layer**: a rewritten
`context/data.tsx`, a rebuilt `routes/session/index.tsx`, a `prompt/index.tsx` that switches to
`v2.session.switchAgent` / `switchModel` / `prompt`, and `dialog-integration.tsx` for their
console-managed providers. nikcli forked the **v1** TUI and has its own `context/sync.tsx`, so
none of that has an attachment point here and none of it was ported.

Four changes were portable. Each is listed with the nikcli-side gap it closes.

| Upstream change                                  | nikcli gap                                                                                      | Ported as                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `component/reconnecting.tsx` + `data.connection` | SSE retries with backoff but **silently**; a dead server is indistinguishable from a hung TUI   | `component/reconnecting.tsx`, connection signals on `context/sdk.tsx`                       |
| `routes/session/rows.ts`                         | Every part is its own row; a run of ten `read`/`grep` calls pushes the answer off screen        | `routes/session/rows.ts` (pure module) + `ExplorationSummary` in `routes/session/index.tsx` |
| `handlers/serve.ts` readiness probe + finalizer  | `serve` prints "listening" on socket bind; `stop()` can hang forever given `idleTimeout: 0`     | `Server.ready()`, bounded drain in `Server.listen`'s `stop` wrapper                         |
| `handlers/event.ts` schema encoding              | SSE serializes raw bus payloads while the HTTP bridge validates responses — asymmetric contract | `BusEvent.encode()`, applied on `/event` and `/global/event`                                |

## Explicitly not ported (already present or not applicable)

- **`FileDiff` on `edit` / `apply-patch`** — this is opencode v2 catching up to v1. nikcli already
  emits `patch` + `additions`/`deletions` (`src/tool/edit.ts`, `src/tool/apply_patch.ts`).
- **`reasoning.time`** — already in `src/session/message-v2.ts` (`ReasoningPartSchema.time`).
- **OpenAI `reasoning: {effort, summary}` nesting** — a fix to opencode's hand-rolled HTTP lowerer.
  nikcli goes through the AI SDK's `providerOptions` (`src/provider/transform.ts`), which nests it.
- **`standalone.ts`, `serve --stdio`, daemon changes** — nikcli has no background service; the TUI
  runs an embedded server in a worker thread, so it is already standalone by construction.
- **`dialog-integration.tsx`** — UI for opencode's console-managed providers. nikcli has connectors
  and auth dialogs.
- **`switchModel` no-op guard** — nikcli has no `model.switched` event; the model is per-prompt.

## 1. Reconnecting overlay

`context/sdk.tsx` exposes `connection.status()` / `attempt()` / `error()`. The SSE loop marks
`connected` when `global.event()` resolves and `reconnecting` on both a throw **and** a clean
stream end — the loop reconnects either way, so the UI must say so either way. Embedded (worker)
mode has no reconnect loop and reports `connected` once its RPC subscription is live.

`app.tsx` renders `<Reconnecting>` above every route and dialog while status is `reconnecting`;
nothing on screen can be trusted to be current while the stream is gone. The component holds a
600 ms grace period before appearing, because the retry loop's first backoff is 250 ms and a blip
that self-heals must not flash a full-screen takeover.

## 2. Exploration row grouping

`routes/session/rows.ts` is a pure, dependency-free reducer (no Solid, no SDK types, no data
layer) — which is why it is unit-testable without a TUI (`test/tui/util/session-rows.test.ts`).

Semantics, adapted from upstream:

- Only **consecutive** exploration tool calls fold. The set is read-only tools
  (`read`, `grep`, `glob`, `list`, `codesearch`, `webfetch`); anything that mutates state is
  excluded so a user skimming a collapsed run cannot miss a side effect.
- A group keeps **one ordered list** (`parts`) with `pending` as a subset view, rather than
  upstream's two disjoint lists — collapsing then cannot reorder or drop a call.
- Runs shorter than `minimum` (2) unfold back into plain rows.
- `completed` flips when something follows the run, or when `closed` says the message finished.

The renderer only collapses **completed** runs: a live run stays expanded so work in progress
stays visible, and so the group row is not rebuilt on every streamed delta (which would remount
its children). Calls awaiting a permission render in full underneath the summary.

Gated by `experimental.tui.explorationGrouping`, default off per this repo's flag convention.
With the flag off the memo returns `props.parts` unchanged, preserving today's stable part
identities in `<For>`.

## 3. `serve` hardening

- `Server.ready(server)` polls `/global/health` (with basic auth when a password is configured)
  before `serve` announces the address, so a broken route table fails at startup instead of on
  the client's first call.
- `Server.listen`'s `stop` wrapper bounds the graceful drain at 3 s and then force-closes.
  Bun's graceful stop waits for every open connection, and this server sets `idleTimeout: 0` —
  one parked keep-alive client (an SSE reader, a backgrounded mobile app) hangs shutdown forever.
  Callers already passing `true` keep the immediate path.

## 4. SSE payload encoding

`BusEvent.encode()` projects a payload onto its registered Effect Schema before serialization.
Encoders are built once per event type; encoded payloads are memoized per event object in a
`WeakMap`, so N concurrent SSE connections share one encode rather than each paying for it —
strictly less work than the previous per-subscriber `JSON.stringify` of the raw payload.

It never drops an event: types still on the legacy zod `define`, and payloads their own schema
rejects, pass through unchanged with a warning.

**Gated by `experimental.events.schemaEncoding`, default off.** Encoding also drops keys the
schema does not declare, and every real event is now registered via `BusEvent.schema` (only test
fixtures show up in `unmigrated()`) — so the blast radius is _all_ events, not a subset. This
repo has already been bitten by tightening a schema against real payloads
(`/config/providers` broke the TUI on 2026-07-15). Soak behind the flag, watching for
`event payload failed to encode` warnings, before considering a default flip.

The flag is resolved once per SSE connection (`BusEvent.encodingEnabled()`), not per event.

## Verification

- `bun run typecheck` — clean.
- `test/tui/util/session-rows.test.ts` — 10 tests, 100% coverage of `rows.ts`.
- `test/tui`, `test/config`, `test/cli`, `test/util`, `test/bus` — 0 failures.
- `test/server` has 2 failures (`httpapi-openapi-components.test.ts`) that reproduce at HEAD and
  are unrelated to this work.
