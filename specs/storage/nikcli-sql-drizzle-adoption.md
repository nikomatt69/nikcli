# Adopt Opencode-Style SQL + Drizzle In Nikcli

| Field    | Value                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status   | **Implemented** (verified 2026-08-14). Group statuses below are current.                                                                                                                                                                   |
| Evidence | `src/database/{database,migration,migration.gen,schema}.ts` exist; `bun:sqlite` and `drizzle(...)` are constructed only there and in data-import migrations; 14 migrations are journaled and asserted by `test/database/database.test.ts`. |
| Next     | [Retire JSON storage](./remove-json-storage.md) — the long tail this document did not cover.                                                                                                                                               |

The "Current Nikcli Inventory" section below describes the state **before** the migration and is kept for the record. Do not read it as current.

## Goal

Move nikcli from scattered SQLite helpers and JSON-backed storage toward the opencode pattern: a central SQLite database runtime, Drizzle-owned schemas, explicit migrations, and domain services/repositories that query through one database capability.

This is not a request to copy opencode wholesale. The target is to adopt the same architectural shape while preserving nikcli's current public APIs and staged migration safety.

## Opencode Reference Findings

Source repo analyzed: `anomalyco/opencode` at `6e2bcafd34174297ffdfaf0450861a3f536cf62c`.

Important reference files:

- `packages/core/src/database/database.ts` defines a central `Database.Service`, opens one database path, applies SQLite pragmas, and runs migrations before exposing `{ db }`.
- `packages/core/src/database/sqlite.bun.ts` wraps `bun:sqlite`, provides a native SQLite layer, a Drizzle layer, and an Effect SQL client layer over the same connection.
- `packages/core/src/database/migration.ts` applies TypeScript migrations through a dedicated `migration` journal table and serializes application with a semaphore.
- `packages/core/src/database/migration.gen.ts` imports migration modules in order instead of scanning the filesystem at runtime.
- `packages/core/src/**/*.sql.ts` owns table schemas near domain modules; `packages/opencode/src/storage/schema.ts` only re-exports those tables for the opencode package boundary.
- `packages/core/src/session/sql.ts` uses Drizzle SQLite schema features for typed JSON columns, branded IDs, foreign keys, composite primary keys, and query indexes.
- `packages/core/src/event.ts` demonstrates the end-state usage: Effect services yield `Database.Service` and execute Drizzle queries/transactions through `db`.
- `specs/storage/remove-opencode-db.md` records the migration away from opencode's older wrapper and captures invariants such as active transaction reuse and post-commit effects.

## Current Nikcli Inventory

Nikcli already has partial Drizzle adoption, but it is fragmented:

- `packages/nikcli/src/db/users.ts` opens `users.db` directly with `new Database(...)`, creates tables by raw SQL, then queries with Drizzle.
- `packages/nikcli/src/account/db.ts` opens `accounts.db` directly with its own raw migration and Drizzle singleton.
- `packages/nikcli/src/workspace/db.ts` opens `workspaces.db` directly, manually alters columns, migrates JSON workspace records, then queries with Drizzle.
- `packages/nikcli/src/mobile/auth.ts` opens `mobile_auth.db` directly, manually creates tables, migrates `mobile-auth.json`, then queries with Drizzle.
- `packages/nikcli/src/storage/db.ts` is a reusable Drizzle opener with PRAGMAs and migration-directory support, but production modules above do not use it.
- `packages/nikcli/src/storage/schema.ts` re-exports existing table schemas, but no central database runtime consumes that schema.
- `packages/nikcli/drizzle.config.ts` points at `src/**/*.sql.ts` and writes SQL to `migration`, but runtime code mostly uses manual `CREATE TABLE IF NOT EXISTS` migrations instead.
- `packages/nikcli/migration/0000_perpetual_lionheart.sql` is generated from schemas, but it is not the same runtime migration model used by the domain DB modules.
- JSON storage remains the default for sessions, messages, parts, todos, permission, question, and assorted storage keys through `packages/nikcli/src/storage/storage.ts`.
- Sync events currently persist to JSON files in `packages/nikcli/src/sync/index.ts`, not SQL.

## Target Shape

### Database Runtime

Create a new central module, for example `packages/nikcli/src/database/database.ts`, with this shape:

- `Database.Service` exposes `{ db }` as the only production database capability.
- `Database.path()` resolves the database file, defaulting to `Global.Path.data/nikcli.db`, with a test/env override such as `NIKCLI_DB`.
- `Database.layerFromPath(filename)` opens a Bun SQLite connection, creates parent directories, registers finalizers, applies PRAGMAs, runs migrations, and returns the service.
- PRAGMAs should match the opencode runtime unless nikcli has a reason to differ: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-64000`, `foreign_keys=ON`, and optionally `wal_checkpoint(PASSIVE)` after startup.
- The initial implementation can use `drizzle-orm/bun-sqlite` synchronously inside an Effect service. A later step can vendor/adopt an Effect Drizzle SQLite adapter if nikcli needs yieldable Drizzle queries.

### Schema Ownership

Keep schemas near their domain modules and aggregate them centrally:

- Keep `packages/nikcli/src/db/users.sql.ts`, `packages/nikcli/src/account/account.sql.ts`, `packages/nikcli/src/workspace/workspace.sql.ts`, and `packages/nikcli/src/mobile/auth.sql.ts`.
- Add SQL schemas for durable session/message/todo/sync tables only when those domains are migrated off JSON storage.
- Change `packages/nikcli/src/storage/schema.ts` or add `packages/nikcli/src/database/schema.ts` to be a pure re-export list, mirroring opencode's package-boundary schema file.
- Prefer Drizzle schema constraints over raw SQL-only constraints. For example, `chat_contacts` should use a composite primary key in `users.sql.ts` if code relies on `onConflictDoNothing()`.

### Migrations

Use opencode's explicit TypeScript migration journal rather than ad hoc runtime `CREATE TABLE` blocks:

- Add `packages/nikcli/src/database/migration.ts` with a `migration` table and ordered migration application.
- Add `packages/nikcli/src/database/migration.gen.ts` that imports migrations in a fixed order.
- Add migration modules under `packages/nikcli/src/database/migration/`.
- Seed the new journal carefully if existing installs already have `users.db`, `accounts.db`, `workspaces.db`, or `mobile_auth.db` files.
- Keep legacy JSON-to-SQL data movement as separate data migrations, not as hidden side effects inside random repository reads.

### Domain Access

Move domain modules in stages:

- Repositories and services should yield or receive `Database.Service` instead of creating their own `new Database(...)` handles.
- Keep public APIs stable first; for example, `AccountDB.getAccount()` can remain synchronous internally until the surrounding service is ready for Effect-native calls.
- Once a domain is behind an Effect service, replace local wrapper helpers with direct service queries.
- Do not let CLI/server handlers import raw Drizzle tables for routine business reads if an existing domain service can answer the query.

## Migration Groups

### Group 1: Central Runtime And Existing Drizzle Tables

Status: Done. `Database.Service` opens `nikcli.db` (override via `NIKCLI_DB`), applies opencode PRAGMAs, and runs the TypeScript migration journal (`migration.ts` + `migration.gen.ts`). `database/schema.ts` is the pure re-export list. `storage/db.ts`, `storage/db.bun.ts`, `storage/schema.ts`, and `storage/schema.sql.ts` were deleted (no remaining callers).

Files:

- `packages/nikcli/src/database/database.ts`
- `packages/nikcli/src/database/schema.ts`
- `packages/nikcli/src/database/migration.ts`
- `packages/nikcli/src/database/migration.gen.ts`
- `packages/nikcli/src/database/migration/*`
- `packages/nikcli/src/storage/db.ts`
- `packages/nikcli/src/storage/schema.ts`

Current usage:

- Four domains each open their own SQLite database and run local raw SQL migrations.
- `storage/db.ts` is close to a reusable opener, but it is not the opencode-style service boundary and is not used by these domains.

Target shape:

- One runtime opens `nikcli.db`, applies PRAGMAs and migrations once, and exports an Effect service.
- Existing table schemas become the first central schema set.
- `storage/db.ts` is either deleted after callers move or retained only as a backwards-compatible thin wrapper around the new runtime.

Suggested first step:

- Create the central database service and migration journal without moving data yet. Add a focused test that opens a temp database, applies migrations, and verifies expected tables exist.

### Group 2: Account, Users, Mobile Auth, Workspace

Status: Done. All four domains query `Database.syncDb()` against `nikcli.db`; their tables are created by `20260610211500_initial`. Legacy `accounts.db`, `users.db`, `workspaces.db`, and `mobile_auth.db` rows are imported once by the `20260611020000_import_legacy_databases` data migration (legacy files are left in place, existing central rows win).

Files:

- `packages/nikcli/src/account/db.ts`
- `packages/nikcli/src/account/repo.ts`
- `packages/nikcli/src/db/users.ts`
- `packages/nikcli/src/mobile/auth.ts`
- `packages/nikcli/src/workspace/db.ts`
- `packages/nikcli/src/workspace/index.ts`

Current usage:

- Each module has an independent lazy singleton, independent PRAGMAs, and independent migration SQL.
- Workspace also performs JSON-to-SQL migration on regular list/get/create paths.

Target shape:

- Each module queries the shared `Database.Service` or a narrow repository backed by it.
- Existing public functions keep behavior while storage moves to `nikcli.db`.
- JSON import/backfill code becomes idempotent database/data migration code with explicit logging.

Suggested order:

- Start with `account/db.ts` because it is small and already has a repository boundary.
- Move `mobile/auth.ts` next; keep its token cache but move `mobile-auth.json` import into a data migration.
- Move `workspace/db.ts` after deciding how to seed old `workspaces.db` rows and old JSON workspace records.
- Move `db/users.ts` last in this group because it includes auth, sessions, chat contacts, chat messages, and active-session file persistence.

### Group 3: Session, Message, Todo, Permission JSON Storage

Status: Done. `SessionRepo`, `MessageRepo`, `TodoRepo`, `PermissionRepo`, and `GoalRepo` back sessions, messages/parts, todos, permission rulesets, and session goals with SQL tables. Existing JSON records are backfilled by `20260611030000_import_json_storage` (sessions/messages/todos/permissions) and `20260814050000_session_goal` (goals) and left in place as the rollout fallback. Auxiliary records (diffs, question, revert, summary) remain on `Storage.Service`, and `Storage.NotFoundError` semantics are preserved at service boundaries.

Files:

- `packages/nikcli/src/session/index.ts`
- `packages/nikcli/src/session/message-v2.ts`
- `packages/nikcli/src/session/todo.ts`
- `packages/nikcli/src/session/revert.ts`
- `packages/nikcli/src/session/summary.ts`
- `packages/nikcli/src/permission/next.ts`
- `packages/nikcli/src/question/*`
- `packages/nikcli/src/storage/storage.ts`

Current usage:

- Sessions, messages, parts, todos, summaries, and many request/permission records are JSON files behind `Storage.Service`.
- The storage service has migrations and locking semantics that callers rely on.

Target shape:

- Add SQL read models for session/message/part/todo before removing JSON writes.
- Backfill existing JSON records into SQL with an idempotent migration.
- Keep JSON storage as a fallback until SQL-backed reads are verified for API, prompt, revert, summary, and todo flows.
- Preserve current `Storage.NotFoundError` behavior at service boundaries while internal persistence changes.

Suggested order:

- Add schema and repository methods for session info reads/lists.
- Add message and part pagination/hydration tables.
- Move todo persistence behind a repository and then to SQL.
- Keep broad `Storage.Service` for non-domain JSON records until each domain has its own SQL-backed interface.

### Group 4: Sync/Event Log

Status: Done. `sync_event` and `sync_sequence` tables created by `20260611010000_sync_event_sequence`; `SyncStorage` keeps the `Sync.emit`/`replay`/`getEvents`/`getLatestSeq` signatures. Sequence allocation and event append run inside a single `BEGIN IMMEDIATE` transaction, so allocation is atomic across processes. Legacy `sync/<projectID>.{events,sequence}.json` files are imported by `20260611040000_import_sync_json` (sequence counters merge via MAX).

Files:

- `packages/nikcli/src/sync/index.ts`
- `packages/nikcli/src/workspace/index.ts`
- `packages/nikcli/src/server/*` routes that expose sync/event data

Current usage:

- Sync events and sequence counters are stored in JSON files per project.
- Sequence allocation is protected by file locks.

Target shape:

- Create `sync_event` and `sync_sequence` SQL tables.
- Allocate sequence numbers inside an immediate SQLite transaction.
- If publish/projector side effects are added, keep post-commit effects outside the transaction, matching opencode's invariant.
- Provide narrow read APIs for HTTP/server routes instead of direct table access from route handlers.

Suggested order:

- Migrate JSON event append/read functions to a SQL repository while preserving the existing `Sync.emit`, `Sync.replay`, `Sync.getEvents`, and `Sync.getLatestSeq` signatures.
- Only introduce projector/after-commit behavior if a nikcli feature requires it.

### Group 5: Cleanup And Deletion

Status: Done. `bun:sqlite` and `drizzle(...)` are only constructed in `src/database/database.ts` (plus migration/data-import modules). The unused `storage/db.ts`, `storage/db.bun.ts`, `storage/schema.ts`, and `storage/schema.sql.ts` helpers were deleted, along with the superseded generated SQL under `packages/nikcli/migration/`. Ad hoc `CREATE TABLE`/`ALTER TABLE` blocks now exist only inside explicit migrations.

Files:

- `packages/nikcli/src/storage/db.ts`
- old per-domain database files/migration blocks
- generated SQL under `packages/nikcli/migration` if superseded by TypeScript migrations

Target shape:

- No production module imports `bun:sqlite` directly except the central database runtime and admin/debug tooling.
- No production module calls `drizzle(...)` directly except the central runtime.
- No domain module runs ad hoc schema migrations on normal reads.
- Drizzle schemas, migration modules, and repositories are the source of truth.

## Invariants To Preserve

- Existing user data in `users.db`, `accounts.db`, `workspaces.db`, `mobile_auth.db`, and JSON storage must be migrated or left readable during rollout.
- `Storage.NotFoundError` semantics must remain visible to callers until the caller contracts change.
- Workspace create/remove rollback behavior must remain atomic enough to avoid dangling sandbox/worktree state.
- Account token refresh must update only token fields and must not overwrite email/url metadata.
- Mobile token verification must preserve the cache behavior and debounced `lastUsedAt` writes.
- Sync sequence allocation must remain atomic per project/aggregate.
- SQLite foreign keys must stay enabled before writes.

## Recommended First PR

Make the first PR small and reversible:

- Add `packages/nikcli/src/database/database.ts`, `schema.ts`, `migration.ts`, `migration.gen.ts`, and an initial migration that creates current account/user/mobile/workspace tables in a single `nikcli.db`.
- Add `test/database/database.test.ts` that opens a temp database through `Database.layerFromPath`, verifies PRAGMAs, verifies the migration journal, and verifies at least one insert/select through Drizzle.
- Do not migrate production domain modules in the first PR unless the test proves the runtime is stable.
- In the second PR, move `account/db.ts` to the new runtime and add a data migration from `accounts.db`.

## Verification Commands

Use these checks while implementing the migration:

- `rg "new Database|drizzle\(" packages/nikcli/src` should eventually return only the central database runtime and test/admin-only helpers.
- `rg "CREATE TABLE IF NOT EXISTS|ALTER TABLE" packages/nikcli/src` should eventually return only explicit migrations or non-database code.
- `bun test test/database/database.test.ts` from `packages/nikcli` should prove runtime startup, migrations, and Drizzle queries.
- `bun test test/account test/mobile test/workspace test/storage` from `packages/nikcli` should cover the first migrated domains.
- `bun run typecheck` from `packages/nikcli` should pass after each group.
