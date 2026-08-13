# Schema Changelog

Status: **Compatibility ledger.** Newest first. Entries keep the names and behavior that were accurate when written; current contracts live in the `*.sql.ts` modules, `message-v2.ts`, and the HttpApi groups.

Every entry corresponds to a file in `packages/nikcli/src/database/migration/`, applied in id order through the `migration` journal table by `DatabaseMigration.apply`. Migrations run inside `BEGIN IMMEDIATE` and roll back as a unit; a failure aborts startup rather than leaving a half-applied schema.

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
