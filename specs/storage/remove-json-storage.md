# Retire `src/storage/storage.ts`

| Field  | Value                                                          |
| ------ | -------------------------------------------------------------- |
| Status | **Proposed and partially unblocked**                           |
| Scope  | `src/storage/storage.ts`, its 19 consumer modules              |
| Buys   | One durability model, one transaction boundary, one error type |

## Goal

Remove the remaining production uses of the JSON key-value store so that everything durable lives in `nikcli.db`.

This is the successor to [SQL + Drizzle adoption](./nikcli-sql-drizzle-adoption.md), which already landed the central database, the migration journal, and domain-owned schemas. Sessions, messages, parts, todos, permissions, and sync events moved in `20260611*`. What remains is the long tail.

This is **not** a request to delete `Storage` in one change. The target is that no production module imports it, after which the file goes.

## What Is Still On JSON

`Storage.Service` is imported by 19 modules:

```
analytics/analytics.ts     loop/manager.ts          session/message-v2.ts
analytics/share.ts         mission/manager.ts       session/revert.ts
artifact/index.ts          mobile/routine.ts        session/stats.ts
background/run.ts          monitor/manager.ts       session/summary.ts
cli/cmd/run.ts             server/mobile/helpers.ts share/share-next.ts
cli/cmd/stats.ts           storage/effect.ts        tool/memory_search.ts
cli/cmd/usage.ts
```

They fall into four groups, and the groups want different treatment:

**1. Domain state that should be SQL.** `loop/manager.ts` is the clearest case: loop definitions, per-run records, and metadata are read, listed, updated, and removed by key prefix — a table with three columns, implemented as a directory tree. `mission/manager.ts` and `monitor/manager.ts` are the same shape. `share-next.ts` and `artifact/index.ts` hold durable records too.

**2. Derived caches.** `session/stats.ts`, `analytics/*`, `cli/cmd/{stats,usage}.ts`, and `tool/memory_search.ts` mostly persist things that can be recomputed. These can move to SQL for consistency or be deleted in favor of queries — decide per module, and prefer deleting.

**3. Ephemeral or process-local state.** PTY records, TUI state, and `background/run.ts` handles. Some of this should not be durable at all.

**4. The error types.** `session/index.ts` still declares `Session.Error = BusyError | Storage.NotFoundError | Storage.IOError` and maps unknown rejections into `Storage.IOError`, even though session rows are SQL now. These types outlived their storage and are the reason a grep for `Storage.` in `session/` looks worse than the reality.

## Why It Is Worth Doing

- **Two durability models.** A crash between a SQL write and a JSON write leaves inconsistent state that no migration can detect, because one half has no schema.
- **`transaction` is not a database transaction.** `Storage.transaction(ops)` takes one lock and applies file operations. It is atomic against other `Storage` callers on the same process and nothing else. Code that reads that name and assumes ACID is wrong in a way that is invisible until it matters.
- **Reads are cached with a 5s TTL** in a module-level LRU capped at 10,000 entries. That is a second, separate consistency model layered on the first.
- **Errors are structural, not semantic.** `NotFoundError` cannot distinguish "no such session" from "the file was deleted underneath us".
- **The migration precedent exists.** `20260611030000_import_json_storage` already shows the pattern: create the table, backfill from the JSON tree, leave the tree in place for downgrade.

## Order Of Work

1. **Untangle the error types first.** Give `Session` its own `NotFoundError` / `IOError` and stop re-exporting `Storage`'s. This is mechanical, touches no persistence, and removes the largest source of misleading grep hits.
2. **`loop/manager.ts` → SQL.** The best-defined domain, and the one whose key-prefix listing is most obviously a query. Use it to establish the repository shape the rest follow.
3. **`mission/manager.ts`, `monitor/manager.ts`, `share-next.ts`, `artifact/index.ts`.** Same shape as 2.
4. **Decide the derived-cache group.** For each, either move it or delete it. Do not move a cache that a query could replace.
5. **Delete `storage/storage.ts` and `storage/effect.ts`.** Keep the JSON tree on disk; a downgrade must still find it.

Steps 1 and 2 are independently valuable and independently revertible. Nothing after step 2 blocks on anything before it except the repository shape.

## Invariants To Preserve

- Every move needs a data migration that backfills the JSON tree into the new table, following `20260611030000_import_json_storage`. A move without a backfill silently loses user data that has no other copy.
- Migrations must stay idempotent: they re-run against a database whose journal was reset, and they must not double-import.
- Adding a migration changes the journal list asserted by `test/database/database.test.ts`. Update it in the same commit.
- Do not read the JSON tree at runtime after a domain has moved. A read-through fallback would resurrect the two-model problem it is meant to end.
