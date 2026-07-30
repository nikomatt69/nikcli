# Gap analysis: nikcli vs effect-smol (v4) — 2026-07-07

> **Superseded snapshot.** Point-in-time audit from 2026-07-07. Several claims below are
> **stale** as of 2026-07-30 — read the “Post-audit corrections” section first, then treat
> the original body as historical evidence, not current truth. Prefer
> `http-api.md` status snapshot, `httpapi-bridge-inventory.md`, and `ROADMAP.md`.

Audit of `packages/nikcli/src` against `specs/effect/*`, `specs/opencode-parity/*`, and the
`.opencode/references/effect-smol` reference tree (packages `effect`, `sql`, `platform-bun`,
plus `migration/*.md`). Two questions: what is still missing, and what can we adopt from
effect-smol to improve `src`.

Branch: `live-main`. Baseline at audit: `effect@4.0.0-beta.65` (later bumped; see httpapi-codegen).
nikcli is **on** effect-smol/v4, so "adopt" means using more of the library we already ship.

## Post-audit corrections (2026-07-30)

| 2026-07-07 claim                                             | 2026-07-30 reality                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| HttpApi only behind explicit `=1`                            | `NIKCLI_EXPERIMENTAL_HTTPAPI` **default-on**                                                                       |
| `/mission`, `/analytics`, `/global`, VCS writes never ported | Many are **bridged** (mission, analytics, global, vcs.apply/status/diff — see inventory)                           |
| Effect OpenAPI surface not present                           | Present (`generate --httpapi`, `NIKCLI_SDK_OPENAPI=httpapi`); **default SDK still Hono** until domain Schema split |
| `server/backend.ts` does not exist                           | **Exists**; production still Hono + in-process bridge                                                              |
| 04 virtualization render flip not wired                      | **Wired** behind `tui.messageVirtualization`                                                                       |
| Auth only Basic on bridge                                    | Issuer JWT via `@nikcli-ai/auth` / `identity-auth.ts` on server path                                               |

**Still open (honest residual gaps):** pure Effect server (delete Hono), mobile/PTY-WS/sync-SSE specials, Effect `Config`/`HttpClient`/`ChildProcess` adoption counts, mega-TUI modularization, plugin SDK named domain types.

## Where we are (verified at audit time — 2026-07-07)

- 228 files import from the `effect` barrel; usage is dominated by `Effect` (197), `Schema`
  (94), `Layer` (68), `Context` (50). The service-shape migration checklist in `guide.md` is
  essentially complete except `SyncEvent` and `Workspace` (both deferred).
- `src/server/httpapi/` had 18 route slices; the bridge carried **123** regex-matched routes
  plus specials (`/event` SSE, streaming prompt) behind HttpApi (now default-on).
- `specs/effect/todo.md` P0 (typed errors, rendering, HTTP contracts) is done; P2–P5 are open.

## What is missing (gaps, by weight) — original 2026-07-07 text

### 1. HTTP layer completion (specs/effect/http-api.md + specs/httpapi-bridge-inventory.md)

> Several bullets in this subsection were closed after the audit — see corrections table.

- **The route inventory only covers the opencode-parity surface.** _(stale partial)_ nikcli-only
  groups have since been classified; many are bridged. Remaining Hono-only: companion HTML,
  mobile runtime, PTY WS, sync SSE, some streaming.
- **OpenAPI/SDK flip.** Effect surface exists; default SDK generation remains Hono until domain
  Effect Schemas replace `Schema.Unknown` for plugin-imported types.
- **Backend fork-at-startup.** `server/backend.ts` exists; pure Effect listener still not default.
- **Sync routes** contract-only / SSE special; not full Effect service rewrite.
- **PTY websocket** unported (classified `special`).

### 2. Effect foundations still Promise/global-shaped (todo.md P2–P5)

Measured on this branch:

| Edge             | Legacy usage                                   | Effect service usage                                         |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| env/config reads | 204 `process.env` reads                        | **0** `Config.*` reads                                       |
| HTTP client      | 132 raw `fetch(` callsites                     | 4 `HttpClient` refs                                          |
| child processes  | 11 files `child_process`, 29 files `Bun.spawn` | **0** `ChildProcessSpawner` refs (guide.md prescribes it)    |
| filesystem       | 72 files import `node:fs`                      | `AppFileSystem`/`BunFileSystem` in migrated services only    |
| route DTOs       | 150 files import zod                           | Schema owns httpapi slices; zod retained for Hono/SDK compat |

- Instance ALS teardown (`INST-1..6`) fully open; `Global.Path` import-time side effects (P3) open.
- `Bus` is callback-based (`subscribe(cb) => unsubscribe`) — the `Stream`-based subscription
  shape shown in `guide.md` ("InstanceState init patterns") does not match the actual bus API.
  Only 2 files in `src` use `Stream` at all.

### 3. opencode-parity residuals (specs/opencode-parity)

- 04 message virtualization: module landed, render flip in `routes/session/index.tsx` still
  soak-gated.
- 05 modularization: mega-components remain (session route 3534 LOC, prompt 2323, viz 2290).
- 06 i18n: scaffold + first surface only.

## What we can take from effect-smol (concrete adoption candidates)

Ordered by fit with the open gaps above:

1. **`effect/unstable/socket` + `BunHttpServer` websockets → PTY** (`SocketServer`,
   `BunSocket`, `BunSocketServer`). This is the designed answer to http-api.md item 15: the
   spec already names `BunHttpServer` ("wraps Bun.serve, … websocket upgrades under Effect
   services") as the final Bun-native target. Replaces `hono/bun upgradeWebSocket` in
   `routes/pty.ts`.
2. **`effect/unstable/eventlog` → Sync.Service (F1.3).** `EventLog`/`EventJournal`/
   `EventLogRemote`/`EventLogServer` (+ `SqlEventJournal` on the existing bun:sqlite DB) is a
   ready-made event-sourced sync engine with encryption and remote sync — exactly the shape
   `/sync start|replay|history` needs. Strongest "don't rebuild it" candidate.
3. **`Config` + `ConfigProvider` → P2 flag deletion.** The RF track's end state ("typed
   runtime/config services") is literally effect `Config`; today there are zero reads against
   204 `process.env` touches. Also unblocks "centralize httpapi auth via Effect Config".
4. **`effect/unstable/http` `HttpClient` (+ `BunHttpClient`) → the 132 raw fetch sites**,
   opportunistically as callers effectify (already a todo.md track; the primitive is unused).
5. **`effect/unstable/process` `ChildProcess`/`ChildProcessSpawner` (+
   `BunChildProcessSpawner`) → PROC track.** guide.md already mandates it; adoption is zero.
   Long-lived LSP children need the stream-adapter work noted in guide.md.
6. **`Stream` + `PubSub`/`Mailbox`/`SubscriptionRef` → Bus.** Give `Bus.Service` a real
   `Stream`-returning `subscribe`, which also fixes the guide/code mismatch and simplifies SSE
   (`httpapi/event.ts`) and TUI sync fan-out.
7. **`FiberMap`/`FiberSet`/`FiberHandle` → background/delegation/session-abort tracking.**
   Zero usage today; the delegation fan-out and per-session abort bookkeeping are hand-rolled.
8. **`effect/unstable/workflow` → loop/mission/scheduler durability.** `/loop` already exposes
   run/abort/pause/resume semantics implemented by hand; Workflow gives durable, resumable,
   crash-safe execution. Evaluate for mission runs and scheduler routines.
9. **`effect/unstable/rpc` → TUI control bridge / mobile interconnect.** `/tui/control/next`
   polling and the desktop/mobile bridges are hand-rolled RPC; optional, evaluate after the
   backend fork.
10. **`@effect/sql` `sqlite-bun`** — optional. `src/database` already wraps drizzle +
    `bun:sqlite` in a `Context.Service`; switching ORMs is not justified on its own, but
    `SqlEventJournal` (item 2) can sit on the same file.

Not recommended now: `effect/unstable/ai` (native-LLM track is on the Vercel AI SDK by
decision), `effect/unstable/cli` (CLI surface is stable), `cluster`/`workers` (no current
need).

The `migration/*.md` rules (yieldable values, `Effect.fn`, layer memoization via the global
memoMap, `Context.Service`, scope/finalizers, v4 Schema names) are already encoded in
`specs/effect/http-api.md` "Effect v4 / opencode Rules To Reuse" and `guide.md`; no new rule
extraction is needed — the gap is application, not documentation.

## Suggested order

1. ~~Complete the true Hono route inventory (include nikcli-only groups) and port the easy JSON
   groups (`/mission`, `/analytics`, `/global`) — same pattern as `httpapi/loop.ts`.~~
   **Done 2026-07-08**: `httpapi/analytics.ts`, `httpapi/global.ts` (instance-less
   `handleGlobal` bridge branch), `httpapi/mission.ts`; `generateFromDescription` moved to the
   neutral `mission/generate.ts`. Remaining Hono-only groups: `/pty` (special), `/connectors`,
   `/chatbot`, `/companion`, `/user`, `/mobile` (separate surface), VCS writes, `/app/*`,
   managed-worktree, session instructions/context/monitor/background.
2. Rebuild the opt-in Effect OpenAPI surface, close the shape gaps, flip the SDK default
   (unlocks every Hono deletion).
3. PTY over Effect websockets (adoption item 1) and the `backend.ts` fork-at-startup with
   `BunHttpServer`.
4. `Sync.Service` on eventlog (adoption item 2), then bridge sync routes.
5. `Config` sweep for P2 (adoption item 3); HttpClient/ChildProcessSpawner opportunistically
   (items 4–5).
6. Bus → Stream (item 6) when touching bus/SSE consumers; FiberMap/Workflow (items 7–8) when
   touching delegation/loop internals.
