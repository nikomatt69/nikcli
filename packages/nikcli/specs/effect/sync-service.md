# Sync.Service extraction — design (Wave 4)

> Status: design only. No code changes in this PR. Captures the path from
> the current free-function namespace (`src/sync/index.ts`) to a typed
> Effect `Service` so the bridge can surface `/sync/*` endpoints.

## 1. Background — why this exists

`src/sync/index.ts` exposes `Sync` as a free-function namespace today:

- `Sync.emitRaw(projectID, aggregate, data, origin)` — writes a row to
  `syncEvent` via `SyncStorage.appendEvent` and notifies `emitListeners`.
- `Sync.getEvents(projectID, aggregate, fromSeq?)` — read.
- `Sync.readAggregate(aggregate)`, `replayWithSnapshot`, `getLatestSeq`,
  `clear`, `onEmit` — auxiliary helpers used by `routes/sync.ts` and
  workspace reducers.
- `SyncStorage` (separate namespace, same file) — the Drizzle-backed
  `eventlog` storage.

The bridge cannot surface `/sync/start`, `/sync/replay`, `/sync/history`,
or `/sync/snapshot` (listed at `specs/httpapi-bridge-inventory.md` lines
393-397) because:

1. `routes/sync.ts:129` calls `Database.syncDb()` directly via Drizzle
   rather than going through any service.
2. `SyncCliInit.startForAllProjects(...)` (`src/sync/cli-init.ts:44`)
   owns the hub connection lifecycle and is not exposed as a service.
3. The `emitListeners` Set (`src/sync/index.ts:299`) is a module-level
   singleton — the bridge must yield it through a service to participate
   in Effect's resource model.

## 2. Target service shape

A single `Sync.Service` exposed from `src/sync/index.ts` (existing file)
with this interface:

```ts
export interface Interface {
  readonly start: (opts: {
    url: string
    token: string
    projectID: string
  }) => Effect.Effect<{ started: boolean; error?: string }, never>

  readonly push: (
    projectID: string,
    input: { aggregate: string; data: unknown; origin?: string },
  ) => Effect.Effect<void, never> // wraps SyncStorage.appendEvent + GlobalBus.emit("event", …)

  readonly outbox: (
    projectID: string,
    aggregate: string,
    since: number,
    limit?: number,
  ) => Effect.Effect<{ events: SyncEventRecord[]; hasMore: boolean }, never>

  readonly snapshot: (
    aggregate: string,
    projectID: string,
  ) => Effect.Effect<{ lastSeq: number; state: unknown } | null, never>

  readonly state: () => Effect.Effect<
    { configured: boolean; url?: string; pending: number; failed: number; lastSeq?: number },
    never
  >
}

export class Service extends Context.Service<Service, Interface>()("@nikcli/Sync") {}
```

### Method bodies — 1:1 to existing code

- `start` → `SyncCliInit.startForAllProjects(...)` (`src/sync/cli-init.ts:44`).
  Closes over the same `NIKCLI_REMOTE_URL` / `NIKCLI_REMOTE_TOKEN` flags,
  but resolves them through `Config.all` rather than reading process globals
  directly (parity with `httpapi/auth.ts` planning — see "Auth via Config"
  in the Wave 3 checklist).
- `push` → `SyncStorage.appendEvent(...)` + `GlobalBus.publish("event", …)`
  (so `HttpApiEvent.handle()` continues to forward).
- `outbox` → inline slice from `routes/sync.ts:203-228`. Returns
  `hasMore: true` if the page returned `limit` rows.
- `snapshot` → `SyncProjection.byAggregate(...)` (`src/sync/projection.ts`).
- `state` → inline slice from `routes/sync.ts:340-411` (TUI stats shape).

## 3. Consumers to update (when the service lands)

| File                                         | Current call                               | After                                                          |
| -------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `src/cli/cmd/sync.ts:44`                     | `SyncCliInit.startForAllProjects` direct   | `Sync.Service.start({...})`                                    |
| `src/cli/cmd/tui/worker.ts:208`              | `remoteStart({...})`                       | `Sync.Service.start({...})`                                    |
| `src/workspace/projection.ts:38`             | `SyncEvents.emit(...)` (already abstracts) | unchanged                                                      |
| `src/server/routes/sync.ts` (all 9 handlers) | direct DB + free-function calls            | thin `httpapi/sync.ts` wrappers                                |
| `tests`                                      | `Sync.emitRaw(...)` direct                 | `Sync.Service.push(...)` (with a `defaultLayer` test override) |

## 4. Bridge impact (after the service exists)

The three pending bridge entries from
`specs/httpapi-bridge-inventory.md` lines 393-397 become:

- `POST /sync/start` → `Sync.Service.start(...)` — payload
  `{ url, token, projectID }`; success `{ started: true }`.
- `GET /sync/history?projectID&aggregate&since` → `Sync.Service.outbox(...)`.
  Pagination via query `?limit=` (default 100, max 1000).
- `GET /sync/snapshot?projectID&aggregate` → `Sync.Service.snapshot(...)`.
- `POST /sync/replay` → `Sync.Service.push(...)` — manual outbox append
  (used by tests and recovery tools).

### SSE branch stays out of the schema layer

`GET /sync/stream` is an SSE feed (server-sent events) and does not fit
schema-encoded bodies. The handler stays a "special" raw `Response` branch
in `bridge.ts` `handle()`, parallel to:

- `/event` — `HttpApiEvent.handle()` (raw `ReadableStream`).
- `/session/:id/message` — `HttpApiPrompt.prompt()` (chunked prompt body).
- `/chatbot/:platform/:name` — `ChatbotHttp.handle()` (raw webhook
  receivers).

## 5. Auth

`/sync/*` already requires `cli-sync` or `studio` scope
(`routes/sync.ts:30-65`). The Effect backend implements the same scope
guard inline in each handler via `authorizeSync(request)` (see
`httpapi/sync.ts`):

- No `?token=` query parameter → request passes through (operator / basic-auth path).
- Token present but `MobileAuth.verify(token)` returns `undefined` → 401 Unauthorized.
- Token valid but scope is not in `{"cli-sync", "studio"}` → 403 Forbidden.
- Token valid with the right scope → request continues.

The check is enforced before any service work runs, mirroring the Hono
`.use("*", ...)` middleware on `routes/sync.ts:93-104`. Mobile and
websocket clients cannot set custom headers, hence the query parameter
— this is the same scheme as `MobileAuth.bearer`.

The OpenAPI-side `HttpApiSecurity.apiKey({ in: "query", key: "token" })`
declaration is a follow-up (the `HttpApiBuilder.middlewareSecurity`
plumbing is non-trivial). The runtime enforcement is in place and
covered by `test/server/httpapi-sync.test.ts` (3 tests for 401, 403, 200).

## 6. Open questions / non-goals

- **`emitListeners` migration.** Today this is a
  `Set<EmitListener>` module-level singleton at
  `src/sync/index.ts:299`; it must move to `Ref<Set<EmitListener>>`
  inside the service so it survives cross-instance lifecycle cleanly.
  `Sync.onEmit` stays a thin shim that delegates to
  `Sync.Service.onEmit` via `Effect.gen`.
- **`Database.syncDb()` direct Drizzle access** at `routes/sync.ts:129`
  must move into a `SyncStorage` method (e.g. `SyncStorage.pushRemote(...)`)
  so the service can yield it via `Layer`. Track as a sub-task inside the
  service PR.
- **Read consistency.** `Sync.Service.outbox(...)` should resolve to a
  single, paginated SELECT against `syncEvent` (composite key
  `(projectID, aggregate, seq)`) — the schema today is already
  indexed on those three columns (`src/sync/sync.sql.ts:36-46`), so no
  schema migration required.

## 7. Cross-references

- `specs/effect/http-api.md` step 15-16 — should add
  "(see `specs/effect/sync-service.md`)" next to the unchecked sync entries.
- `specs/httpapi-bridge-inventory.md` — three unchecked sync entries
  mention the dependency on this design.

## 8. Out of scope for this PR

- No implementation of `Sync.Service` itself.
- No changes to `routes/sync.ts` (the Hono file stays the active backend
  until the service exists).
- No SDK regeneration (the existing `managedWorktree*` entries the generator
  produced are still valid).
