# Sync architecture

How nikcli keeps instances, workspaces and sessions on a single, replayable
backend — locally and (optionally) across machines through a remote hub.

## The unified event log

Everything flows through one SQLite table, `sync_event` (see
`packages/nikcli/src/sync/sync.sql.ts`):

| column                  | meaning                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `project_id`            | owning project                                                     |
| `aggregate`             | the entity the event belongs to (`wrk_…`, `ses_…`)                 |
| `seq`                   | per-`(project, aggregate)` monotonic sequence (from `sync_sequence`) |
| `type` / `data`         | event envelope (`{ type, properties }`)                            |
| `workspace_id`          | denormalized routing metadata (nullable)                           |
| `origin` / `origin_seq` | `local` or `remote:<client>`; the origin server's seq when remote  |

Appends go through `Sync.emitRaw(projectID, aggregate, data, options?)`
(`packages/nikcli/src/sync/index.ts`), which reserves the next sequence
number and inserts atomically (`BEGIN IMMEDIATE`, safe across processes
sharing `nikcli.db`). Compaction trims aggregates past 1000 events down
to 500; snapshots make that safe (below).

### Writers

- **Workspace event loop** (`workspace/index.ts` + `workspace/sync-bridge.ts`):
  events observed from a remote workspace's SSE stream (session status,
  permissions, questions, …) are journaled under the workspace id, plus
  lifecycle events (`workspace.created`, `workspace.removed`, …) used by the
  projector to rebuild the workspace row from cold start.
- **Session sync bridge** (`session/sync-bridge.ts`): restore events of
  *local* sessions (not bound to a workspace) are journaled under the
  session id. Workspace-bound sessions are skipped — the workspace loop
  owns them. Opt out with `NIKCLI_DISABLE_SESSION_JOURNAL=1`.
- **Remote sync** (below): events received from the hub are replayed into
  the local log with `origin="remote:<client>"` so they are never pushed
  back.

### Readers

- **Workspace restore** (`Workspace.restore` → `buildRestorePayload`):
  replays the workspace aggregate, filtered to client-facing restore event
  types (lifecycle events stay internal to projection).
- **Incremental catch-up**: `GET /experimental/workspace/:id/events?from=<seq>`
  returns sequenced events past the client's last seen `seq` — the recovery
  path for TUI reconnects and mobile resume.
- **Projection with snapshots** (`sync/projector.ts`, `sync/reducer.ts`,
  `sync/snapshot.ts`): pure reducers replay an aggregate on top of the last
  snapshot (`sync_snapshot`), re-snapshotting every N events. Snapshots are
  cache, not source of truth: corruption falls back to full replay.

## Remote sync (optional, hub-and-spoke)

Disabled unless configured — nikcli is 100% local by default.

```sh
export NIKCLI_REMOTE_URL=https://s.nikcli.store
export NIKCLI_REMOTE_TOKEN=<token with cli-sync scope>
# optional: keep bootstrap from autostarting (explicit commands still work)
export NIKCLI_REMOTE_AUTOSTART=false
```

`RemoteSync.start({ url, token, projectID })` (`sync/remote-sync.ts`) runs
three loops:

1. **Subscribe**: SSE from `GET /sync/stream`; received events are replayed
   locally with a `remote:` origin.
2. **Push**: local `Sync.emitRaw` appends are enqueued in `sync_outbox`
   (`sync/outbox.ts`) and drained every 5s via `POST /sync/event`.
   The outbox is offline-first: writes always succeed locally; the backlog
   drains on reconnect with exponential backoff (1s → cap 24h, then failed).
3. **Renumbering**: the hub renumbers received events per aggregate and
   records the client's seq in `origin_seq` (last-writer-wins per
   `(aggregate, seq)`).

Starts are idempotent per `(url, projectID)`: bootstrap
(`sync/cli-init.ts`, wired in `project/bootstrap.ts`), `nikcli serve` and
`nikcli sync` share one connection instead of stacking hooks and timers.
Server-side, `/sync/*` routes (`server/routes/sync.ts`) require a Bearer
token with `cli-sync` or `studio` scope (`mobile/auth.sql.ts`).

`nikcli sync status` shows connection, last seq, and outbox depth.

## Instance hot reload

Instances reload their configuration surface in-process, no restart:

- Per-instance caches opt in with `InstanceState.make(init, { reloadable: true })`
  (`effect/instance-state.ts`); Config opts in, so agents, commands,
  permissions and plugins re-read from disk on the next access.
- `InstanceReload` (`project/reload.ts`) watches the global `nikcli.json`,
  the project `nikcli.json`, and `.nikcli` config directories (300ms
  debounce, serialized per directory) and invalidates the reloadable caches.
- Every reload is announced as `instance.reload.started` /
  `instance.reloaded` on the bus — and therefore on the server's SSE
  stream — so connected clients refetch instead of polling.
- Runtime state (bus subscriptions, live sessions, loop engines,
  schedulers) is intentionally untouched; that is what makes reloading safe
  mid-session.
- Explicit trigger: `POST /config/reload`. Opt out of the watcher with
  `NIKCLI_DISABLE_HOT_RELOAD=1`.

## Migration notes

Older builds buffered workspace restore events in a JSON column
(`workspace.events`). Migrations `20260630000000_sync_unify` and
`20260630000100_workspace_drop_events` import that data into `sync_event`
and drop the column; `sync/migrate-from-workspace.ts` is the idempotent
importer. `sync_event` has been the single source of truth since.

## Environment variables

| variable                         | effect                                             |
| -------------------------------- | -------------------------------------------------- |
| `NIKCLI_REMOTE_URL`              | hub base URL; enables remote sync (with token)     |
| `NIKCLI_REMOTE_TOKEN`            | Bearer token (`cli-sync` scope)                    |
| `NIKCLI_REMOTE_AUTOSTART=false`  | don't autostart from bootstrap                     |
| `NIKCLI_DISABLE_SESSION_JOURNAL` | don't journal local session events                 |
| `NIKCLI_DISABLE_HOT_RELOAD`      | don't watch config files for instance hot reload   |
