# Integration Master Plan

Canonical remaining-work document for nikcli. Unifies the Effect migration
(`specs/effect/`), the v2 feature specs (`specs/v2/`, repo-root `specs/v2/`),
the OpenAPI translation cleanup (`specs/openapi-translation-cleanup.md`), and
TUI plugin gaps into dependency-ordered epochs.

This file was originally drafted 2026-05-14, lost as uncommitted work, and
rematerialized 2026-06-12 from the surviving epoch ordering plus a fresh
audit of the codebase.

Status legend: `[x]` done, `[~]` in progress / partial, `[ ]` not started.

## Audit snapshot (2026-06-12)

What is already integrated and must not be re-planned:

- `[x]` `session.init` route removal (`specs/v2/session.md`, commit `c79a7ad`).
- `[x]` Session v2 read path: `src/session/v2/` entry/event/stepper/projector,
  `GET /session/:id/v2/entries` + `/v2/state`, `session.v2.updated` over SSE
  (`specs/v2/message-shape.md` implementation status).
- `[x]` Support dialog + `support` agent + docs index (`specs/v2/support-dialog.md`,
  commit `036a09f`).
- `[x]` OpenAPI cleanup PR 1 (drift tests) and PR 2 (workspace query injection
  removal); PR 3/PR 4 concrete first targets.
- `[x]` TUI command shim *file* removal (`command-shim.ts` deleted;
  `api.command` is now implemented natively in `plugin/runtime.ts`).
- `[x]` SQL + Drizzle storage adoption (commit `50b55f9`).

## Epochs

### E1: Error system + session domain schemas

Two parallel streams that unblock everything else.

- `[ ]` `ERR-4` sweep remaining `NamedError.create(...)` to
  `TaggedErrorClass` (`specs/effect/todo.md` P0).
- `[ ]` `RENDER-2` audit CLI and TUI surfaces for opaque error rendering.
- `[ ]` Session domain schemas (Phase P of the former MASTER-PLAN; see
  `specs/effect/schema.md` for the schema inventory).

### E2: Sync/Workspace services + boot cache + HTTP error boundary

- `[ ]` `Sync.Service` + `Workspace.Service` (Phase I).
- `[ ]` ScopedCache boot cache (Phase G).
- `[ ]` `HTTP-2` audit one route group for explicit error contracts and
  shrink the catch-all error boundary (`specs/effect/todo.md` P0).

### E3: HttpApi route parity

- `[ ]` Remaining session routes, sync routes, SSE, PTY WebSocket, TUI
  control on the Effect `HttpApi` (`specs/effect/http-api.md`,
  `specs/effect/routes.md`). Hono (`server/server.ts`) stays the live
  server until parity.

### E4: OpenAPI/SDK flip

- `[x]` Translate cleanup PRs 1–4 and 7: superseded — the rewritten
  `src/server/httpapi/` layer has no post-generation transform at all
  (see the status header in `specs/openapi-translation-cleanup.md`).
- `[~]` PR 5 (declared API errors per endpoint): first endpoint done —
  `PATCH /config` declares `ConfigUpdateError` (400, legacy
  `{ name, data }` body). Sweep the remaining groups together with the
  `HTTP-2` error-contract work.
- `[ ]` PR 6: decide whether the SDK exposes auth metadata at flip time.
- `[ ]` Flip the SDK generator default to the Effect-generated spec
  (Phase L) once E3 parity holds.

### E5: Hono deletion

- `[ ]` Delete Hono group by group once E3/E4 give parity
  (`server/server.ts`, `server/proxy.ts`, `workspace/workspace-server/`,
  `workspace/session-proxy-middleware.ts`). Phase N. "Kill Hono" from
  `specs/v2/todo.md` (repo root).

### E6: ALS cleanup

- `[ ]` `INST-1`..`INST-6`: delete legacy `Instance.*` API
  (`specs/effect/todo.md` P4), keep shrinking `project/instance.ts`
  (`specs/effect/loose-ends.md`).

### E7: v2 features

- `[~]` TUI notifications default-on (`specs/v2/notifications.md`).
- `[~]` `api.keymap` layered command/binding API for TUI plugins;
  `api.command` becomes a deprecated alias (`specs/v2/tui-command-shim.md`,
  `specs/v2/keymappings.md`).
- `[~]` Message shape: persistence of v2 events is done
  (`session_v2_event` log + `SessionV2.events/replay`, see
  `specs/v2/message-shape.md`); the native v2 write path (engine swap)
  and Option 2 prompt mutators for hooks remain.
- `[ ]` Support dialog follow-ups: markdown rendering, copy-to-clipboard,
  file attach, per-session model pick, adaptive quickstart
  (`specs/v2/support-dialog.md`).
- `[ ]` Embedded library API sketch (`specs/v2/api.ts`) — depends on E5/E6;
  do not start before the server/instance layers settle.
- `[ ]` Server plugin API v2, config rework, granular hot-reload events
  (repo-root `specs/v2/todo.md`).

### E8: RuntimeFlags + global paths

- `[ ]` Sweep lingering `Flag.*` reads, delete `flag.ts` and its fixture
  (`specs/effect/todo.md` P2).
- `[ ]` Explicit init for global paths, drop mutable test overrides (P3).

### E9: packages/server extraction

- `[ ]` Extract the server package last (Phase O,
  `specs/effect/server-package.md`).

## Sequencing rules

- Within an epoch, items are parallel unless stated.
- E1 and E2 can overlap; E3 needs E1 errors; E4 needs E3 route parity for
  the flip (translate-cleanup PRs can proceed earlier); E5 needs E4; E6
  after E5 reduces churn; E7 items are independent of E1–E6 except the
  embedded API; E8–E9 are tail work.
- Every commit that touches the Effect migration must update
  `specs/effect/schema.md` (and this file when an epoch item changes
  state) in the same commit.
