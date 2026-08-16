# SQLite domain-state layer — structured analysis

> Read-only research. Scope: `src/database/` plus the per-domain `*.sql.ts`
> schema modules and their repos under `src/<domain>/`. All paths are relative
> to `packages/nikcli/`. Line ranges are approximate and cite where each fact
> was observed.

---

## 1. Core database layer (`src/database/`)

### 1.1 `database.ts` — the `Database` namespace (249 lines)

This is the single entry point for all domain storage. It wraps a raw
`bun:sqlite` connection with a Drizzle ORM client and exposes a synchronous
singleton for domain modules.

- **`Database.path()`** (`database.ts:26-33`) resolves the DB filename from
  `NIKCLI_DB` (absolute or `:memory:`), otherwise `<Global.Path.data>/nikcli.db`.
- **`open(filename)`** (`database.ts:35-57`) opens the native `bun:sqlite`
  `Database`, sets PRAGMAs, applies migrations, and returns an `Interface`
  `{ db, native, filename }`. PRAGMAs:
  - `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`
  - `cache_size = -64000`, `foreign_keys = ON`, `mmap_size = 0` (opencode #22428)
  - `DatabaseMigration.apply(native)` runs the migration pipeline at open.
- **Synchronous singleton** (`database.ts:63-85`):
  - `singleton()` memoizes one `Interface` per filename (`Map<string, Interface>`).
  - `syncDb(): Client` (`database.ts:78-80`) returns the shared Drizzle client —
    **this is the accessor every repo module calls**.
  - `syncNative(): BunDatabase` (`database.ts:83-85`) returns the raw client
    (used by admin/debug tooling and the analytics raw-SQL paths).
- **Lifecycle**: `close(filename)` (`:88-96`), `closeAll()` (`:99-102`),
  `isOpen()` (`:105-107`).
- **Transactions & post-commit effects** (`database.ts:109-177`):
  - `TxOrDb = Client | Tx`; `transaction(fn, { behavior })` (`:137-159`) runs a
    Drizzle transaction, **defaulting to `behavior: "immediate"`** so a
    read-then-write (e.g. allocate a sequence number then append) takes the write
    lock up front. Nested calls join the outer transaction.
  - `effect(fn)` (`:166-172`) queues a side effect to run **after commit**
    (never on rollback, never while the write lock is held).
  - `use(fn)` (`:175-177`) is sugar for `fn(syncDb())`.
- **Effect layer**: `layerFromPath(filename)` / `defaultLayer` (`:183-198`) for
  Effect-based consumers (analytics rollup uses `Database.defaultLayer`).
- **Periodic WAL checkpoint** (`database.ts:209-247`): every 5 min runs
  `PRAGMA wal_checkpoint(TRUNCATE)`; disabled by `NIKCLI_DISABLE_WAL_CHECKPOINT=1`.

### 1.2 `schema.ts` — the Drizzle schema re-export (23 lines)

`schema.ts` is the type-level schema for `drizzle(native, { schema })`. It
re-exports every per-domain `sqliteTable` const in one place. See §4 for the
full map. **Notable:** the analytics tables (`analytics_stat`, `analytics_share`,
`analytics_publish`) are _not_ re-exported here (see §3.14).

### 1.3 `index.ts` (3 lines)

Re-exports the two namespaces: `Database` (`./database`) and `DatabaseMigration`
(`./migration`).

### 1.4 `migration.ts` — migration runner (45 lines)

`DatabaseMigration` namespace:

- `Migration` type = `{ id, up(database: BunDatabase): void }` (`:8-11`).
- `completed()` (`:13-23`) ensures a `migration` bookkeeping table
  (`id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL`) and returns the set
  of already-applied ids.
- `apply(database, input = migrations)` (`:25-43`) applies each pending migration
  inside `BEGIN IMMEDIATE … COMMIT`, inserting a `migration` row with
  `Date.now()`; on error it rolls back and rethrows.

### 1.5 `migration.gen.ts` (57 lines)

Generated registry. Imports each `migration/*.ts` default export and lists all 27
in `export const migrations = [...]` in timestamp order. It `satisfies
DatabaseMigration.Migration[]`.

### 1.6 `migration/` directory (27 files)

One file per migration, named `<UTC timestamp>_<slug>.ts`, each exporting a
`default { id, up(database) }` object. Two migration styles coexist:

1. **DDL-only** — e.g. `20260610211500_initial.ts` (`:4-100`): a single
   `database.exec(...)` with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX`.
2. **DDL + JSON import** — e.g. `20260814020000_domain_sql.ts` (`:194-285`):
   creates the tables, then reads the legacy `storage/<domain>/*.json` tree next
   to the DB file and `INSERT OR IGNORE`s each record, leaving the JSON in place
   as a downgrade fallback.

The full ordered list (from `migration.gen.ts:29-56`):

| migration id                                     | what it does                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `20260610211500_initial`                         | account, config, users, user_sessions, chat, mobile_tokens, workspace |
| `20260611000000_session_message_todo_permission` | session/message/todo/permission tables                                |
| `20260611010000_sync_event_sequence`             | sync event + sequence                                                 |
| `20260611020000_import_legacy_databases`         | legacy DB import                                                      |
| `20260611030000_import_json_storage`             | JSON-storage import                                                   |
| `20260611040000_import_sync_json`                | sync JSON import                                                      |
| `20260612000000_session_v2_event`                | v2 event table (later dropped)                                        |
| `20260630000000_sync_unify`                      | sync unification                                                      |
| `20260630000100_workspace_drop_events`           | drop `workspace.events`/`event_limit`                                 |
| `20260716000000_user_external_subject`           | `users.external_subject`                                              |
| `20260805000000_session_entry`                   | `session_entry` table                                                 |
| `20260805120000_drop_session_v2_event`           | drop v2 event table                                                   |
| `20260805130000_session_entry_id_order`          | entry id ordering                                                     |
| `20260811000000_analytics_stat`                  | `analytics_stat`                                                      |
| `20260814000000_loop_sql`                        | loop tables                                                           |
| `20260814010000_session_time_suspended`          | `session_info.time_suspended` (partial index)                         |
| `20260814020000_domain_sql`                      | mission/monitor/share/artifact tables + JSON import                   |
| `20260814030000_project_sql`                     | `project` table                                                       |
| `20260814040000_analytics_share`                 | `analytics_share`                                                     |
| `20260814050000_session_goal`                    | `session_goal`                                                        |
| `20260814060000_background_run`                  | `background_run`                                                      |
| `20260814070000_routine`                         | `routine`                                                             |
| `20260814080000_session_diff`                    | `session_diff`                                                        |
| `20260814090000_workspace_json`                  | workspace JSON import                                                 |
| `20260814100000_session_pending`                 | `session_pending`                                                     |
| `20260814110000_instruction_sync`                | `instruction_blob`/`instruction_state`                                |

---

## 2. Test helper: `withIsolatedDatabase` (`test/helpers/sqlite.ts:49-90`)

Per-test SQLite isolation for worktree/workspace (and sync-engine) tests:

- Creates a unique temp dir (`nikcli-iso-*` via `fs.mkdtemp`).
- Sets `NIKCLI_TEST_HOME`, `NIKCLI_DISABLE_PROJECT_CONFIG=1`, and
  `NIKCLI_DB=<home>/data/nikcli.db` for the duration of the callback.
- `finally` block calls `Database.close(databasePath)` (`:78-79`) to close the
  synchronous handle, restores the previous env vars, and removes the temp dir.
- `skip: true` option (`:53-58`) bypasses isolation for tests that need the
  global DB (e.g. migration tests).
- The sibling `test/helpers/sqlite.test.ts` tests the helper itself.

---

## 3. Per-domain breakdown

Legend for the "sync" column: **sync** = the repo calls `Database.syncDb()`
synchronously. Most repos also accept a `tx: Executor = db()` parameter on writes
so a projector can run inside the same transaction (see the executor pattern in
§5).

### 3.1 Session (`src/session/`)

The largest domain. It owns several tables (one `*.sql.ts` each) and one repo per
table.

**Tables:**

| table (const)                            | file                      | purpose / key columns                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session_info` (`sessionInfo`)           | `session.sql.ts:7-38`     | Session rows. `id` PK; `project_id`, `title`, `directory` NOT NULL; `parent_id`, `workspace_id` nullable; `version`; **`data`** = full JSON `Session.Info`; `created_at`, `updated_at`; `time_suspended` (nullable, private). Indexes: `idx_session_info_project/parent/workspace`. Partial index on `time_suspended` lives only in migration `20260814010000_session_time_suspended` (comment at `:21-30`). |
| `message_info` (`messageInfo`)           | `message.sql.ts:8-26`     | Messages. `id` PK; `session_id` FK→`session_info.id` `ON DELETE CASCADE`; `role`; `info` = full JSON `MessageV2.Info`; `prompt_data` (canonical admitted prompt); `created_at`. Indexes: session, role.                                                                                                                                                                                                      |
| `message_part` (`messagePart`)           | `message.sql.ts:32-49`    | Parts. `id` PK; `message_id`, `session_id` NOT NULL; `type`; `info` = JSON Part; `sort_key` (ordering = id for ascending). Indexes: message, session, `(message_id, sort_key)`.                                                                                                                                                                                                                              |
| `todo_info` (`todoInfo`)                 | `todo.sql.ts:7-12`        | One row per session; `session_id` PK; `todos` JSON array (default `"[]"`).                                                                                                                                                                                                                                                                                                                                   |
| `session_goal` (`sessionGoal`)           | `goal.sql.ts:14-18`       | One live goal per session; `session_id` PK; `data` = whole `SessionGoal.State`; `updated_at`.                                                                                                                                                                                                                                                                                                                |
| `session_diff` (`sessionDiff`)           | `diff.sql.ts:17-21`       | Session-level `FileDiff[]`; `session_id` PK; `data`; `updated_at`. Not a rebuildable cache (see comment `:7-16`).                                                                                                                                                                                                                                                                                            |
| `session_pending` (`sessionPending`)     | `pending.sql.ts:3-17`     | Pending prompt inputs; `id` PK; `session_id`; `delivery` enum `steer`/`queue`; `message_id`; `data`; `created_at`. Unique index `(session_id, message_id)`.                                                                                                                                                                                                                                                  |
| `instruction_blob` (`instructionBlob`)   | `instruction.sql.ts:3-6`  | Content-addressed instruction bodies; `hash` PK; `body`.                                                                                                                                                                                                                                                                                                                                                     |
| `instruction_state` (`instructionState`) | `instruction.sql.ts:8-15` | Fold state per session; `session_id` PK; `epoch_seq`, `updated_seq`; `parent_session_id`, `parent_seq`; `data` = JSON Fold.                                                                                                                                                                                                                                                                                  |
| `session_entry` (`sessionEntry`)         | `v2/entry.sql.ts:22-41`   | Flat v2 read model; `id` PK (entry id `evt_…`); `session_id`, `message_id`; `type`; `ref` = stable upsert identity; `info` JSON `SessionEntry`; `timestamp`. Unique index `(session_id, ref)`.                                                                                                                                                                                                               |

**Repos** (all synchronous via `Database.syncDb()`):

- **`SessionRepo`** (`repo.ts:13-171`): `get`, `getByProject`/`list`, `listAll`,
  `upsert`, `update` (read-modify-write editor), `remove`, `suspend(ids)`
  (`:141-144`), `consumeSuspended()` (`:153-160`, single `UPDATE … RETURNING` for
  crash-safe resume), `getChildren`. Writes accept `Executor` (projector-safe).
  `rowToInfo`/`infoToRow` (`:28-47`) extract indexed columns and JSON-encode the
  rest into `data`.
- **`MessageRepo`** (`message-repo.ts:10-145`): `getMessage`, `listMessages`,
  `countMessages`, `upsertMessage`, `removeMessage` (deletes parts first),
  `getPart`, `listParts`, `upsertPart`, `removePart`, `getMessageWithParts`,
  `getPromptData`/`setPromptData`.
- **`TodoRepo`** (`todo-repo.ts:10-45`): `get` (returns `[]` on missing/corrupt),
  `upsert`, `remove`.
- **`GoalRepo`** (`goal-repo.ts:12-69`): `get`, `upsert`, `update` (clone+mutate),
  `remove`. `readState` (`:17-26`) validates shape and drops corrupt rows.
- **`SessionDiffRepo`** (`diff-repo.ts:12-58`): `get` (empty list on miss/corrupt),
  `upsert`, `remove`.
- **`InstructionRepo`** (`instruction-repo.ts:6-198`): `get`, `put`, `removeSession`,
  `putBlobs`/`getBlobs`/`getBlob`, `applyDelta` (fold merge), `inherit`,
  `advanceEpoch`, `latestAggregateSeq` (reads `sync_sequence`).
- **`SessionEntryRepo`** (`v2/entry-repo.ts:14-109`): `upsert` (keyed on `ref`),
  `list`, `byRef`, `count`, `messageCount` (distinct messages), `removeRef`,
  `removeMessage`, `clear`.
- **`SessionPending`** (`pending.ts:10-230`): zod/Effect `Info` + `ConflictError`;
  `canonical`, `getByMessage`, `get`, `steer`, `insert` (id = `Identifier.ascending("pending")`),
  `list`, `remove`, `removeSession`. Decodes through `Info.parse` (`:139-152`).

**Invariants:** session ids are descending (`Identifier.descending("session")`),
message/part ids ascending. `message_info`/`message_part` cascade-delete with the
session. `data`/`info` JSON columns carry the whole record; indexed columns exist
only because something queries/orders by them.

### 3.2 Project (`src/project/`)

- **`project`** (`project.sql.ts:19-31`): `id` PK; `data` = whole `Project.Info`;
  `directories` (**nullable** — `null` = "never written"/bootstrap trigger, `[]` =
  real empty list); `created_at`, `updated_at`; index `idx_project_updated`.
- **`ProjectRepo`** (`repo.ts:14-126`): `get`, `upsert` (leaves `directories`
  alone, `:64-78`), `update` (throws if missing), `list` (id-ascending),
  `directories`/`setDirectories`, `clear` (test isolation). `readInfo` (`:30-45`)
  sanitizes and drops corrupt rows; `toRow` excludes `directories`.
- **Invariant:** the `directories` column is the former `["project_directory", id]`
  record, deliberately split from `data` so a full `Info` upsert can't clobber it.

### 3.3 Loop (`src/loop/`)

- **`loop`** (`loop.sql.ts:21-37`): `id` PK; `project_id`, `name`, `enabled`,
  `paused`, `trigger_kind` NOT NULL; **`started_runs` nullable** (`null` = "never
  counted" → one-time derive-from-history); `data` = whole `LoopDefinition`;
  `created_at`; index `(project_id, created_at)`.
- **`loop_run`** (`loop.sql.ts:48-63`): `id` PK; `loop_id`, `project_id`, `status`
  NOT NULL; `started_at`, `ended_at` (nullable), `data`; **no FK to `loop`**
  (runs outlive definitions; `LoopRepo.remove` cascades instead, `:44-46`).
- **`LoopRepo`** (`repo.ts:19-288`): definitions — `list` (newest first), `get`,
  `upsert` (leaves `started_runs` alone), `remove` (transaction deletes runs then
  loop); counter — `startedRuns`, `setStartedRuns`, `incrementStartedRuns`
  (`UPDATE … SET started_runs = started_runs + 1 … RETURNING`, `:158-166`); runs —
  `putRun`, `updateRun` (transaction RMW, `:197-224`), `listRuns`, `countRunRecords`,
  `listRunsByProject`, `listRunsByStatus`, `trimRuns` (keep newest `limit`, `:275-287`).
- **Sanitizers** live in `schema.ts`: `sanitizeDefinition` (`loop/schema.ts:182`),
  `sanitizeRun` (`:202`); constants `HISTORY_LIMIT = 50` (`:43`),
  `LOOP_RUN_LEASE_MS = 15_000` (`:49`), `MAX_CONCURRENT_RUNS = 3` (`:42`).

### 3.4 Mission (`src/mission/`)

- **`mission`** (`mission.sql.ts:15-28`): `id` PK; `project_id`, `name`, `status`
  NOT NULL; `data` = whole `MissionDefinition`; `created_at`; index
  `(project_id, created_at)`. No separate counter record (unlike loops).
- **`mission_exec`** (`mission.sql.ts:38-53`): `id` PK; `mission_id`, `project_id`,
  `status` NOT NULL; `started_at`, `ended_at` (nullable), `data`; **no FK to
  `mission`** (same outlive rationale as loops).
- **`MissionRepo`** (`repo.ts:14-220`): definitions — `list`, `get`, `upsert`,
  `remove` (transaction); execs — `putExec`, `updateExec` (transaction RMW),
  `listExecs`, `listExecsByStatus`, `trimExecs`, `countExecRecords`.
- **Sanitizers** in `schema.ts`: `sanitizeDefinition` (`mission/schema.ts:251`),
  `sanitizeExec` (`:266`); `HISTORY_LIMIT = 100` (`:26`),
  `MISSION_EXEC_LEASE_MS = 15_000` (`:29`).

### 3.5 Monitor (`src/monitor/`)

- **`monitor`** (`monitor.sql.ts:14-28`): `id` PK; `session_id`, `status` NOT NULL;
  `data` = whole `Monitor.Record`; `created_at`, `updated_at`; indexes
  `(session_id, created_at)` and `(status)`.
- **`MonitorRepo`** (`repo.ts:13-73`): `get(sessionId, id)`, `upsert`,
  `listRunning()` (every `status = "running"` row across sessions, `:66-72`).
  The in-process `ActiveRuntime` map is the live source; this is the durable copy.

### 3.6 Share (`src/share/`)

- **`session_share`** (`share.sql.ts:13-17`): `session_id` PK; `mode` nullable;
  `data` = whole `Session.ShareInfo`.
- **`local_share`** (`share.sql.ts:25-37`): `id` PK (public share id); `session_id`
  NOT NULL; `data` (holds `items`); `created_at`, `updated_at`; index `(session_id)`.
- **`ShareRepo`** (`repo.ts:11-105`): `get`, `put`, `remove` (session share) and
  `getLocal`, `putLocal`, `removeLocal`. `LocalShare` type at `:18-27`.

### 3.7 Artifact (`src/artifact/`)

- **`artifact`** (`artifact.sql.ts:13-26`): composite PK `(session_id, id)`;
  `data` = store record **including secret**; `created_at`, `updated_at`; index
  `(session_id, updated_at)`.
- **`ArtifactRepo`** (`repo.ts:13-72`): `get(sessionId, id)`, `upsert` (conflict
  target `[session_id, id]`), `list(sessionId)` (newest-updated first, secrets
  still present — manager strips them on the way out).

### 3.8 Background (`src/background/`)

- **`background_run`** (`run.sql.ts:16-33`): composite PK `(project_id, id)`
  (generated names unique per project); `status`, `parent_session_id` NOT NULL;
  `data` = whole `BackgroundRun.Record`; `created_at`, `updated_at`; indexes
  `(project_id, created_at)`, `(project_id, status)`, `(parent_session_id, created_at)`.
- **`BackgroundRunRepo`** (`repo.ts:12-120`): `get`, `upsert`, `update`
  (clone+mutate), `list` (oldest first), `listRunning`, `listForParent`.
  `readRecord` (`:29-39`) validates and drops corrupt rows.

### 3.9 Sync (`src/sync/`)

Sync is both the **event log** for remote/multi-device sync _and_ the write path
for event-sourced domain mutation (see `sync-event.ts:13-40`).

**Tables** (`sync.sql.ts`):

- **`sync_event`** (`:7-49`): `id` PK; `project_id` NOT NULL; `workspace_id`
  nullable; `aggregate`; `seq`; `type`; `data` JSON; `timestamp`; `origin`
  (default `"local"`); `origin_seq` nullable. Six indexes incl.
  `(project_id, aggregate, seq)` and `(project_id, origin, aggregate, seq)`.
- **`sync_snapshot`** (`:55-71`): composite PK `(project_id, aggregate,
aggregate_id)`; `last_seq`; `state` JSON; `updated_at`.
- **`sync_outbox`** (`:77-93`): `id` PK; `event_id`, `target` NOT NULL; `status`
  default `"pending"`; `attempts` default 0; `last_error`; `next_attempt_at`;
  `created_at`; indexes `(status, next_attempt_at)` and `(event_id)`.
- **`sync_sequence`** (`:99-109`): composite PK `(project_id, aggregate)`; `seq`
  default 0.

**Repos / namespaces:**

- **`SyncEvent`** (`sync-event.ts:41-466`) — event sourcing engine: `define`,
  `project`, `init`, `run` (`:297-335`, allocates seq + projects + logs in one
  immediate transaction), `replay` (`:344-369`, gap = fatal, redelivery safe),
  `history` (`:389-412`), `remove`, `subscribeAll`, `payloads`. Publishing is
  deferred to `Database.effect` (`:260-284`).
- **`SyncStorage`** (`index.ts:31-…`): `loadEvents`, `saveEvents`, `loadSequence`,
  `saveSequence`, `appendEventWith` (with compaction at `MAX_EVENTS_PER_AGGREGATE = 1000`,
  trim to 500). Also `Sync.notify` (`index.ts:317`).
- **`Outbox`** (`outbox.ts:29-147`): `enqueue` (idempotent on `(eventId, target)`),
  `drain` (exponential backoff 1s→24h, max 50 attempts, permanent-failure marking),
  `status`.
- **`SyncSnapshot`** (`snapshot.ts:27-88`): `load`, `save`, `clear`; a cache, not
  a source of truth (`SNAPSHOT_INTERVAL = 100`).

### 3.10 Workspace (`src/workspace/`)

- **`workspace`** (`workspace.sql.ts:12-29`): `id` PK; `project_id` NOT NULL;
  `name` default `""`; `branch` nullable; `config` JSON NOT NULL; `status`
  nullable (connection status); `time_used` default 0; `created_at`, `updated_at`;
  index `(project_id)`. NOTE: `events`/`event_limit` were removed in
  `20260630000_sync_unify` (comment `:6-10`).
- **`WorkspaceDB`** (`db.ts:12-128`): `get`, `list(projectID?)`, `getStatus`,
  `setStatusColumn`, `upsert` (atomic), `touch` (bump `time_used`), `remove`.
  `toInfo` parses `config` JSON (`:46-55`).

### 3.11 User (`src/user/`)

- **`users`** (`users.sql.ts:7-23`): `id` PK; `username`/`email` UNIQUE NOT NULL;
  `external_subject` UNIQUE nullable; `password_hash` NOT NULL; `display_name`;
  `role` default `"user"`; `created_at`, `updated_at`.
- **`user_sessions`** (`users.sql.ts:29-44`): `id` PK; `user_id` FK→`users.id`
  CASCADE; `token_hash` UNIQUE; `expires_at`; `created_at`.
- **`chat_contacts`** (`users.sql.ts:50-62`): composite PK `(user_id, contact_id)`,
  both FK→`users.id` CASCADE; `created_at`.
- **`chat_messages`** (`users.sql.ts:68-86`): `id` PK; `sender_id`/`receiver_id`
  FK→`users.id` CASCADE; `content`; `read` boolean default false; `created_at`.
- **`UserDB`** (`users.ts:13-681`): auth + chat in one namespace. Functions:
  `isAdminEmail`, `create` (bcrypt hash), `findByEmail`, `findById`,
  `ensureExternalUser`, `verifyPassword`, `createSession`/`verifySession` (in-memory
  cache + JOIN query), `revokeSession`, `revokeAllUserSessions`, `listUsers`,
  `hasUsers`, `updateUser` (RETURNING), `deleteUser`, and chat: `addContact`,
  `removeContact`, `listContacts`, `searchUsers`, `sendMessage`, `getMessages`,
  `markMessagesRead`, `getUnreadCount`, `getTotalUnreadCount`. Uses `syncDb()`
  via `db()` (`:70-72`).

### 3.12 Account (`src/account/`)

- **`account`** (`account.sql.ts:7-16`): `id` PK; `email`, `url`, `access_token`,
  `refresh_token` NOT NULL; `token_expiry`; `created_at`, `updated_at`.
- **`config`** (`account.sql.ts:22-26`): singleton `id` PK default 1;
  `active_account_id`, `active_org_id` nullable.
- **`AccountDB`** (`db.ts:13-157`): `getAccount`, `listAccounts`, `upsertAccount`,
  `persistToken` (token-only update, `:107-119`), `deleteAccount`, `getConfig`
  (5s in-memory cache), `setActiveAccount`, `setActiveOrg`, `getActiveAccountId`,
  `getActiveOrgId`.
- **`AccountRepo`** (`repo.ts:5-145`): higher-level wrapper over `AccountDB`:
  `persistToken`, `getRow`, `get`, `list`, `persistAccount`, `remove`, `active`,
  `use`. Types in `schema.ts` (`AccountID`, `OrgID`, `AccessToken`, `RefreshToken`,
  `DeviceCode`, `UserCode`, …).

### 3.13 Mobile (`src/mobile/`)

- **`mobile_tokens`** (`auth.sql.ts:7-26`): `id` PK; `name`, `hash` NOT NULL;
  `created_at`; `last_used_at`, `expires_at` nullable; `scope` default `"mobile"`
  (`mobile` | `cli-sync` | `studio`); index `(scope)`.
- **`MobileAuth`** (`auth.ts:14-256`): `all`, `list`, `create`, `remove`, `verify`
  (in-memory cache + debounced `last_used_at` write), `bearer`. Also lazily
  migrates the legacy `mobile-auth.json` into SQLite (`migrateFromJson`, `:105-137`).
- **`routine`** (`routine.sql.ts:15-29`): composite PK `(project_id, id)`;
  `paused` NOT NULL; `data` = whole `Routine.Record`; `created_at`, `updated_at`;
  index `(project_id, created_at)`.
- **`RoutineRepo`** (`repo.ts:12-101`): `get`, `upsert`, `update` (clone+mutate),
  `list` (newest first), `remove`. `readRecord` (`:28-39`) validates/drops corrupt rows.

### 3.14 Analytics (`src/analytics/`)

- **`analytics_stat`** (`stat.sql.ts:25-67`): rollup rows keyed by
  `(grain, period_key, provider, model)` (unique index). Counters: `sessions`,
  `messages`, `tool_calls`, token buckets, `cost_micro_cents`, `duration_ms`,
  `updated_at`.
- **`analytics_share`** (`stat.sql.ts:77-81`): one row `id = 'local'`; `install_id`;
  `created_at`.
- **`analytics_publish`** (`stat.sql.ts:88-100`): published-period cursor;
  unique `(grain, period_key)`; `published_revision`, `published_at`.
- **Access pattern is _raw SQL_, not the Drizzle client.** The three tables are
  _defined_ in `stat.sql.ts` but **not re-exported in `schema.ts`**, and the
  modules read/write via `Database.syncNative()` / `Database.Service.native`:
  - `AnalyticsRollup` (`rollup.ts:20-…`) runs `DELETE/INSERT/UPDATE … SELECT`
    over `analytics_stat`/`analytics_publish`, deriving rollups from
    `message_info` with `json_extract` (`rollup.ts:73-100+`).
  - `AnalyticsShare` (`share.ts:35-…`) reads/writes `analytics_share` via
    `native().query(...)` (`share.ts:72-93`).

### 3.15 Permission (`src/permission/`)

- **`permission_ruleset`** (`permission.sql.ts:7-12`): `project_id` PK; `rules`
  JSON array of `PermissionNext.Rule` (default `"[]"`).
- **`PermissionRepo`** (`permission-repo.ts:10-45`): `get` (empty on miss/corrupt),
  `upsert`, `remove`.

---

## 4. `schema.ts` re-export map (`src/database/schema.ts:1-23`)

| exported const(s)                                         | source module                 |
| --------------------------------------------------------- | ----------------------------- |
| `account`, `config`                                       | `@/account/account.sql`       |
| `chatContacts`, `chatMessages`, `users`, `userSessions`   | `@/user/users.sql`            |
| `mobileTokens`                                            | `@/mobile/auth.sql`           |
| `workspace`                                               | `@/workspace/workspace.sql`   |
| `sessionInfo`                                             | `@/session/session.sql`       |
| `messageInfo`, `messagePart`                              | `@/session/message.sql`       |
| `sessionEntry`                                            | `@/session/v2/entry.sql`      |
| `todoInfo`                                                | `@/session/todo.sql`          |
| `sessionGoal`                                             | `@/session/goal.sql`          |
| `sessionDiff`                                             | `@/session/diff.sql`          |
| `sessionPending`                                          | `@/session/pending.sql`       |
| `instructionBlob`, `instructionState`                     | `@/session/instruction.sql`   |
| `permissionRuleset`                                       | `@/permission/permission.sql` |
| `syncEvent`, `syncSequence`, `syncSnapshot`, `syncOutbox` | `@/sync/sync.sql`             |
| `loop`, `loopRun`                                         | `@/loop/loop.sql`             |
| `mission`, `missionExec`                                  | `@/mission/mission.sql`       |
| `monitor`                                                 | `@/monitor/monitor.sql`       |
| `sessionShare`, `localShare`                              | `@/share/share.sql`           |
| `artifact`                                                | `@/artifact/artifact.sql`     |
| `backgroundRun`                                           | `@/background/run.sql`        |
| `routine`                                                 | `@/mobile/routine.sql`        |
| `project`                                                 | `@/project/project.sql`       |

**Not re-exported (intentionally):** `analyticsStat`, `analyticsShare`,
`analyticsPublish` (from `@/analytics/stat.sql`) — analytics uses raw SQL, so they
stay out of the typed Drizzle `schema` object.

---

## 5. Cross-cutting invariants and patterns

1. **Synchronous singleton.** Every repo calls `Database.syncDb()` (or
   `syncNative()` for analytics). The connection is a per-filename singleton
   memoized in `database.ts:63-85`, so there is exactly one `bun:sqlite` handle
   per DB file per process.
2. **Executor pattern for writes.** Repos that participate in the sync
   event-sourcing write path define `type Executor = Database.TxOrDb` and default
   their write methods to `db()` so a projector can pass the ambient transaction
   (`SessionRepo.upsert`, `MessageRepo.upsertMessage`, `InstructionRepo.put`,
   `ProjectRepo.upsert`, `LoopRepo.upsert`, `MissionRepo.upsert`, `ShareRepo.put`,
   `ArtifactRepo.upsert`, `SessionEntryRepo.upsert`, etc.). Reads stay on the
   shared client.
3. **Whole-record `data`/`info` JSON columns.** Almost every domain stores the
   complete record as a JSON string in one column (`data`, `info`, `rules`,
   `todos`, `config`, `state`) and extracts only the columns something must
   query, order by, or index on.
4. **Sanitization on read.** Domain repos that replaced JSON trees (`LoopRepo`,
   `MissionRepo`, `ProjectRepo`, `BackgroundRunRepo`, `RoutineRepo`, `GoalRepo`,
   `SessionDiffRepo`, `TodoRepo`, `PermissionRepo`) parse JSON on the way out and
   drop corrupt/partial records rather than surface them.
5. **IDs.** `TEXT` primary keys, generated via `Identifier.descending("session")`
   (sessions) or `Identifier.ascending("…")` (messages, parts, pending `"pending"`,
   sync `"sync"`, outbox `"outbox"`, account `"usr"`, mobile `"mat"`). Composite
   PKs appear where a name is only unique within a project (`artifact`,
   `background_run`, `routine`, `sync_snapshot`, `sync_sequence`, `chat_contacts`).
6. **Timestamps.** `INTEGER` millisecond epoch (`created_at`/`updated_at` or
   `time.created`/`time.updated` mirrored into columns).
7. **Deliberately nullable columns encode state**, not absence of a value:
   - `project.directories` — `null` = "never written" (bootstrap), `[]` = empty.
   - `loop.started_runs` — `null` = "never counted" (derive once from history).
   - `session_info.time_suspended` — null = not suspended (partial index).
8. **Foreign keys** exist only where cascade-delete is wanted and safe:
   `message_info`/`message_part` → `session_info`; `user_sessions`/`chat_*` →
   `users`. **`loop_run` and `mission_exec` deliberately have no FK** so runs can
   outlive their definition; deletion cascades in `LoopRepo.remove` /
   `MissionRepo.remove`.
9. **Transactions default to `immediate`** (`database.ts:137-159`) so
   read-then-write sequences (sequence allocation, counter increments) are safe
   across processes sharing one DB file.
10. **Post-commit effects** (`Database.effect`) are used by `SyncEvent.process`
    to fan out bus notifications only after commit (`sync-event.ts:260-284`).
