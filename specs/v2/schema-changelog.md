# Schema Changelog

Status: **Compatibility ledger.** Newest first. Entries keep the names and behavior that were accurate when written; current contracts live in the `*.sql.ts` modules, `message-v2.ts`, and the HttpApi groups.

Every entry corresponds to a file in `packages/nikcli/src/database/migration/`, applied in id order through the `migration` journal table by `DatabaseMigration.apply`. Migrations run inside `BEGIN IMMEDIATE` and roll back as a unit; a failure aborts startup rather than leaving a half-applied schema.

## 2026-08-14: Instruction Sync Tables

`20260814110000_instruction_sync`

- Add `instruction_blob` keyed by SHA-256 hash, storing canonical JSON bodies once.
- Add `instruction_state` keyed by session, holding the rebuildable fold (`values`, `order`, `epoch_values`, `epoch_order`) plus epoch/parent sequences.
- New bus/sync event `session.instructions.updated` carries only a delta of hashes. Request assembly renders from stored values. Compaction advances the epoch without reading sources.

Compatibility: additive. Existing sessions have no fold until the next model request admits a complete initial delta. The HTTP event union gains `session.instructions.updated`.

## 2026-08-14: Workspace JSON Backfill Folds Into The Journal

`20260814090000_workspace_json`

- Import leftover `storage/workspace/*.json` records into the existing `workspace` table. Inserts are `OR IGNORE`. The JSON tree stays on disk as the downgrade fallback.
- `WorkspaceDB.migrateFromStorage` is gone; list/create/get no longer scan JSON at runtime.

Compatibility: nothing on the wire changed. Missing workspaces throw `Workspace.NotFoundError` (`WorkspaceNotFoundError`); the HTTP literal stays `"NotFoundError"`.

## 2026-08-14: Session Diffs Move Off JSON Storage

`20260814080000_session_diff`

- Add `session_diff` keyed by `session_id`, with `data` holding the whole `Snapshot.FileDiff[]`. Lookups are always by session.
- This is not a rebuildable cache. `Snapshot.track` only `write-tree`s (no ref), so `gc --prune=7.days` drops the trees `computeDiff` would need. Share import also writes a ready-made list that may never have had snapshot hashes.
- Backfill from `storage/session_diff/<sessionID>.json`. Inserts are `OR IGNORE`. The JSON tree stays on disk as the downgrade fallback.

Compatibility: nothing on the wire changed. A missing row is an empty list, matching the old cache miss. Session delete removes the row through `SessionDiffRepo.remove`.

## 2026-08-14: Routines Move Off JSON Storage

`20260814070000_routine`

- Add `routine` with composite primary key `(project_id, id)` — generated names are only unique within a project, matching the former `["routine", projectID, id]` key.
- `data` holds the whole `Routine.Record`. `paused` is extracted because restore/register consults it; trigger tokens stay inside `data` and `getByToken` still scans the project.
- Backfill from `storage/routine/<projectID>/<id>.json`. Inserts are `OR IGNORE`. The JSON tree stays on disk as the downgrade fallback.

Compatibility: nothing on the wire changed. `Routine` keeps its `async` signatures. `get` returns `undefined` when missing (same as `LoopManager.get`); the mobile handler answers 404. Bootstrap still calls `restoreSchedulers`.

## 2026-08-14: Background Runs Move Off JSON Storage

`20260814060000_background_run`

- Add `background_run` with composite primary key `(project_id, id)` — generated names (`happy-blue-fox`) are only unique within a project, matching the former `["background_run", projectID, id]` key.
- `data` holds the whole `BackgroundRun.Record`. `status` and `parent_session_id` are extracted because `listRunning` / `listForParent` query them. Owner/lease/heartbeat stay inside `data` and are checked in process after the running set is loaded.
- Backfill from `storage/background_run/<projectID>/<id>.json`. Inserts are `OR IGNORE`. The JSON tree stays on disk as the downgrade fallback.

Compatibility: nothing on the wire changed. `BackgroundRun` keeps its `async` signatures. A missing run now throws `Error` (`Background run "<id>" not found.`) rather than `Storage.NotFoundError`; callers already treated any throw as missing.

## 2026-08-14: Session Goals Move Off JSON Storage

`20260814050000_session_goal`

- Add `session_goal` keyed by `session_id`, with `data` holding the whole `SessionGoal.State` and `updated_at` extracted from `timeUpdated`. Lookups are always by session, so there is no second extracted column.
- Backfill from `storage/goal/<sessionID>.json`. Inserts are `OR IGNORE`. The JSON tree stays on disk as the downgrade fallback.

Compatibility: nothing on the wire changed. `SessionGoal.Service` keeps its Effect signatures. Session delete removes the row through `GoalRepo.remove` instead of the JSON key.

## 2026-08-14: Analytics Share-State And Snapshot Queries

`20260814040000_analytics_share`

- Add one-row `analytics_share` (`id = 'local'`) for the anonymous-reporting install UUID. Backfill from `storage/analytics/share-state.json`. Inserts are `OR IGNORE`. The JSON tree stays on disk as the downgrade fallback.
- `GET /analytics/global`, `/daily`, `/session`, `/sessions` now query `message_info` / `session_info` / `message_part` instead of the JSON snapshot tree. `Analytics.record*` is a no-op. `analytics_stat` remains the publishable rollup used by `/analytics/data` and `AnalyticsShare`.

Compatibility: response shapes unchanged. A leftover JSON snapshot that is not also in `message_info` (messages deleted after the snapshot was written) is no longer served — the cache was never a second source of truth.

## 2026-08-14: Project Identity Moves Off JSON Storage

`20260814030000_project_sql`

- Add `project` with `data` holding the whole `Project.Info`, `id` as the primary key, and `created_at` / `updated_at` extracted for ordering.
- Absorb `["project_directory", projectID]` into nullable `project.directories`. `NULL` means "never written" and still triggers the bootstrap-from-sandboxes path; a stored `[]` is a real empty list. The column is excluded from the identity upsert the same way `loop.started_runs` is.
- Backfill from `storage/project/…` and `storage/project_directory/…`. Inserts are `OR IGNORE`; directory updates only fill a `NULL` column. The JSON tree stays on disk as the downgrade fallback.

Compatibility: nothing on the wire changed. `Project.Service` keeps its Effect signatures. Callers that listed `["project"]` (`session/stats`, `cli/cmd/{stats,usage}`, analytics backfill) now call `ProjectRepo.list()`.

## 2026-08-14: Missions, Monitors, Shares, Artifacts Move Off JSON Storage

`20260814020000_domain_sql`

- Add `mission` + `mission_exec` (same shape as `loop` / `loop_run`, including no foreign key so a `running` exec can be recovered after the mission is deleted).
- Add `monitor` keyed by monitor id, with `session_id` and `status` extracted so `reconcile` is one query over `running` rows.
- Add `session_share` (keyed by session) and `local_share` (keyed by the public share id).
- Add `artifact` with a composite primary key `(session_id, id)` — lookups are always that pair, and the secret stays inside `data`.
- Backfill from `storage/mission/…`, `storage/mission_exec/…`, `storage/monitor/…`, `storage/session_share/…`, `storage/local_share/…`, and `storage/artifact/…`. Inserts are `OR IGNORE`. The JSON tree stays on disk as the downgrade fallback.

Compatibility: nothing on the wire changed. Managers keep their `async` signatures. `Session.getShare` reads `ShareRepo` and emits `SessionNotFoundError` when the row is missing; the HTTP literal stays `"NotFoundError"`.

## 2026-08-14: Graceful-Restart Continuation

`20260814010000_session_time_suspended`

- Add the private, nullable `session_info.time_suspended` and a **partial** index (`WHERE time_suspended IS NOT NULL`) — the column is null for essentially every row, so a full index would be dead weight on a hot table.
- Non-null means: a server suspended this session during graceful shutdown, and the next server may make one attempt to resume it.

Compatibility: invisible to clients. `Session.Info` is reconstructed from the `data` column alone, so the new column cannot reach a response body. It is deliberately absent from the `set` clause of both `SessionRepo.upsert` and `SessionRepo.update` — adding it there would clear pending suspensions on any unrelated session write.

## 2026-08-14: Loops Move Off JSON Storage

`20260814000000_loop_sql`

- Add `loop` (definition + `started_runs`, indexed by `project_id, created_at`) and `loop_run` (indexed by `loop_id, started_at` and by `project_id, status`).
- Backfill from `storage/loop/…`, `storage/loop_run/…`, and `storage/loop_meta/…`. Inserts are `OR IGNORE`, so re-running against a database whose journal was reset cannot double-import. The JSON tree stays on disk as the downgrade fallback.

Two decisions worth remembering:

- **`loop.started_runs` is nullable.** `null` means "never counted" and is what triggers the derive-from-history path for loops created before the counter existed. `NOT NULL DEFAULT 0` would have erased that distinction and silently reset every existing loop's `maxRuns` budget.
- **`loop_run` has no foreign key to `loop`.** Runs must outlive their definition: `listRunningRuns` recovers `running` rows left by a process that died, and that has to work even if the loop was deleted in between. The cascade is explicit in `LoopRepo.remove`, in one transaction with the definition delete.

Compatibility: nothing on the wire changed. `loop/manager.ts` keeps its `async` signatures even though every operation underneath is now synchronous.

## 2026-08-11: Analytics Aggregates

`20260811000000_analytics_stat`

- Add `analytics_stat` with grain/period, model, and publish indexes, plus `analytics_publish`.
- Aggregates are derived and rebuildable; deleting the tables costs history, not correctness.

## 2026-08-05: Session Entries Replace The Parallel v2 Event Log

`20260805000000_session_entry`, `20260805120000_drop_session_v2_event`, `20260805130000_session_entry_id_order`

- Add `session_entry` (session and message indexes) as the persisted projection of the flat entry model.
- Drop `session_v2_event`. It held a v2 event stream translated off the bus and written in parallel with the v1 rows it derived from — two write paths for one truth. Entries are now persisted transactionally and the durable event log is `sync_event`.
- Drop `session_entry.sort_key`. Entry ids are derived (`SessionEntry.idForPart`) so that **lexicographic id order is conversation order**, which removes the re-sort from both the server and its clients.

Compatibility: entries are rebuildable from `message_info` / `message_part` via `SessionEntry.fromV1Part`, so the drop is not lossy. Clients that sorted by `sort_key` must sort by id.

## 2026-07-16: External Identity Subject

`20260716000000_user_external_subject`

- Add `users.external_subject` for the unified OAuth flow, so a local user row can be bound to an identity-provider subject without a second table.

## 2026-06-30: One Event-Sourced Backend For Sessions And Workspaces

`20260630000000_sync_unify`, `20260630000100_workspace_drop_events`

- Extend `sync_event` with `workspace_id`, `origin`, `origin_seq` and matching indexes. The event log becomes the lingua franca for both session and workspace aggregates.
- Add `sync_snapshot` for cold-start projection, so a CLI boot does not replay thousands of events.
- Add `sync_outbox` for offline-first push to a remote hub.
- Add `mobile_tokens.scope`, so one token table authorizes `cli-sync` clients in addition to mobile pairing.
- Drop `workspace.events` and `workspace.event_limit` — a parallel event log. Safe only because `WorkspaceDB.appendEvent` was removed in the same release and the data was migrated by the `migrate-from-workspace` script first.

## 2026-06-12: Session v2 Event Table

`20260612000000_session_v2_event`

- Add `session_v2_event`. Superseded and dropped 2026-08-05; see above.

## 2026-06-11: JSON Storage Becomes SQL

`20260611000000_session_message_todo_permission`, `20260611010000_sync_event_sequence`, `20260611020000_import_legacy_databases`, `20260611030000_import_json_storage`, `20260611040000_import_sync_json`

- Add `session_info`, `message_info`, `message_part`, `todo_info`, `permission_ruleset` with project/parent/workspace and session/role/sort indexes. `session_info.data` keeps the full serialized `Session.Info` for fields not extracted into columns — the extracted columns exist for indexing, not as the schema of record.
- Add `sync_event` and `sync_sequence`.
- **Data migrations, not schema:**
  - import rows from the legacy per-domain SQLite files (`accounts.db`, `users.db`, `workspaces.db`, `mobile_auth.db`) into the central `nikcli.db`, looked up next to the main database;
  - backfill JSON storage records into the new SQL read models;
  - backfill per-project sync JSON files into `sync_event` / `sync_sequence`.

Compatibility: the legacy files are read, not deleted. A downgrade still finds them; a re-upgrade re-imports idempotently.

## 2026-06-10: The Central Database

`20260610211500_initial`

- Create `nikcli.db` with `account`, `config`, `users`, `user_sessions`, `chat_contacts`, `chat_messages`, `mobile_tokens`, `workspace`.
- Establishes the runtime that everything above depends on: one connection at `Global.Path.data/nikcli.db` (override with `NIKCLI_DB`, absolute path or `:memory:`), WAL, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-64000`, `foreign_keys=ON`, and `mmap_size=0` so the process footprint does not track the database file size.

## Rules For New Entries

- One entry per release-visible schema change, newest first, naming the migration id.
- State the compatibility consequence explicitly: what an older client sees, and what a downgrade loses.
- A migration that only imports or backfills data is still worth an entry, marked as such.
- Adding a migration changes the journal list that `database.test.ts` asserts. Update that test in the same commit.
