# Effect Drizzle SQLite Adapter

| Field   | Value                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status  | **Blocked** by the roadmap (see below); nothing in this document is implemented                                                                                                               |
| Scope   | New `packages/effect-drizzle-sqlite`, then `packages/nikcli/src/database/database.ts`                                                                                                         |
| Buys    | Yieldable Drizzle queries inside `Effect.gen`, without hand-rolling the adapter per call site                                                                                                 |
| Blocker | ROADMAP non-negotiable 3 ("an alternate database layer") and Deferred Choices ("Effect SQL"). Needs a measured bottleneck, a compatibility case, and a recorded decision before the first PR. |

## Blocked By The Roadmap

[../ROADMAP.md](../ROADMAP.md) forbids this adoption twice, and both clauses predate this document:

- Non-negotiable decision 3: "Do not introduce Hono, hey-api, a parallel config schema, **an alternate
  database layer**, or a parallel plugin runtime."
- Deferred Choices: "Do not adopt … **Effect SQL** … merely because the APIs exist. Reconsider only
  with a measured bottleneck, a compatibility case, and a separate decision."

Nothing below may be built until all three exist: a measured bottleneck, a compatibility case, and a
recorded decision. "Drizzle queries should be yieldable" is an ergonomics argument, not a measured
bottleneck.

This matters for sequencing, not just paperwork. [retire-database-wrapper.md](./retire-database-wrapper.md)
was written as this spec's consumer, but its groups 1 and 2 do not need the adapter and are therefore
not blocked — group 1 has already landed without it. Only groups 3 and 4 wait here.

## Goal

Vendor the Drizzle `effect-sqlite` adapter shape as a workspace package so nikcli can use it before
upstream Drizzle ships it.

This is **not** a nikcli storage abstraction. The package is generic — Drizzle + Effect + SQLite. No
nikcli paths, migrations, tables, transaction hooks, post-commit behavior, or domain language lives
in it. `packages/nikcli` consumes it; the package does not know nikcli exists.

## Where nikcli Is Today

`src/database/database.ts` is a **synchronous** Drizzle-over-`bun:sqlite` singleton with an Effect
layer bolted on the side:

```ts
export function syncDb(): Client // drizzle(native, { schema })
export function transaction<T>(fn: (tx: TxOrDb) => T, opts?): T
export function effect(fn: () => void): void
export function use<T>(fn: (db: Client) => T): T
export const defaultLayer // Layer providing Database.Service
```

Domain modules call `syncDb()` / `Database.transaction(...)` directly from synchronous code. The
Effect layer exists mostly so tests can point a scope at a different file; it is not how the write
path is authored.

Open-time configuration is fixed and deliberate: WAL journal, `synchronous = NORMAL`,
`busy_timeout = 5000`, `cache_size = -64000`, `foreign_keys = ON`, and `mmap_size = 0` so the process
footprint does not track the database file size. A background timer runs
`PRAGMA wal_checkpoint(TRUNCATE)` every five minutes so the WAL does not grow without bound.

## The Two Semantics The Wrapper Must Preserve

These are the reason this is a migration spec and not a swap. Both live in
`src/database/database.ts` today and both are load-bearing.

**1. Nested `transaction` joins the outer transaction.** A nested call runs `fn(syncDb())` against
the _current_ transaction rather than opening a second one. SQLite has no nesting that would help
here, and a rolled-back inner write must not be able to publish.

**2. `Database.effect(fn)` queues a post-commit side effect.** Inside a transaction the effect is
pushed onto a queue drained _after_ the commit succeeds — never on rollback, and never while the
write lock is still held. Outside a transaction it runs immediately, because the caller's write has
already landed. A failing post-commit effect is logged and does not fail the transaction.

`transaction` defaults to `behavior: "immediate"` and that default is not cosmetic: a
read-then-write sequence (allocate a sequence number, then append) must take the write lock up front,
or two processes sharing `nikcli.db` can both read the same number. `SyncEvent.run` depends on this.

Any Effect port keeps all three properties. The shape is already half there: `{ tx, afterCommit }` is
what the body receives today, and an Effect port would carry it in Effect context rather than as a
parameter.

## Package Shape

```text
packages/effect-drizzle-sqlite/package.json
packages/effect-drizzle-sqlite/src/index.ts
packages/effect-drizzle-sqlite/src/effect-sqlite/*
packages/effect-drizzle-sqlite/src/sqlite-core/effect/*
packages/effect-drizzle-sqlite/test/sqlite.test.ts
```

Package name: `@nikcli-ai/effect-drizzle-sqlite`, matching the `@nikcli-ai/*` scope used by
`util`, `llm`, `plugin`, and `sdk-next`. Model the package layout on `packages/http-recorder`, which
is the existing example of a small vendored-adapter workspace package.

Initial exports mirror Drizzle's own surface rather than inventing one:

```ts
export { EffectLogger } from "drizzle-orm/effect-core"
export * from "./effect-sqlite/driver"
export * from "./effect-sqlite/session"
export { migrate } from "./effect-sqlite/migrator"
export * as EffectDrizzleSqlite from "."
```

Think of it as a vendored `drizzle-orm/effect-sqlite`, not a new storage service API. Do not invent an
`Interface<TDatabase>` abstraction unless the Drizzle port already has one.

```ts
const db = yield * EffectDrizzleSqlite.make({ relations }).pipe(Effect.provide(EffectDrizzleSqlite.DefaultServices))

yield * db.select().from(users)
yield *
  db.transaction(
    (tx) =>
      Effect.gen(function* () {
        yield* tx.insert(users).values({ name: "Ada" })
      }),
    { behavior: "immediate" },
  )
```

## Runtime Constraint: Bun

nikcli is all-Bun at runtime. The client the adapter targets is the Bun SQLite client; a Node client
layer is only worth adding if a consumer appears that cannot run on Bun. This is a narrower choice
than upstream's open question, and it is narrower because the answer is already fixed here.

The current pin is `drizzle-orm` 0.41.0 with `effect` at the repo-wide `4.0.0-rc.112`. Whichever
Drizzle branch the adapter is vendored from has to work against that pair or the pin moves first, in
its own change.

## Migration Strategy

1. Add `@nikcli-ai/effect-drizzle-sqlite` with a tiny in-memory/file SQLite test schema — **not**
   nikcli domain tables.
2. Port the Drizzle Effect SQLite adapter, preserving upstream names and API shape.
3. Test adapter-level guarantees only:
   - query builders are yieldable Effect values,
   - `transaction(…, { behavior: "immediate" })` commits successful writes,
   - a failed transaction rolls back,
   - migrations run once and in order,
   - the close finalizer closes the underlying SQLite database.
4. Add the package as a dependency of `packages/nikcli`.
5. Port `src/database/database.ts` into a thin wrapper over the adapter plus nikcli's own
   transaction/post-commit context.
6. Keep every existing call site working first: `Database.syncDb()`, `Database.transaction(...)`,
   `Database.close/closeAll/isOpen`.
7. Only after that, migrate call sites to yielding Drizzle queries.
8. Only then build domain stores on top of the wrapper.

Step 6 is where nikcli differs most from upstream's plan. Upstream's wrapper is already
Effect-shaped; nikcli's is synchronous and called from synchronous code across the whole `src` tree.
The compatibility wrapper has to keep returning plain values for those call sites, which means the
adapter is introduced _underneath_ a synchronous facade before anything above it changes.

## What Stays In `packages/nikcli`

- Database path selection (`NIKCLI_DB`, `Global.Path.data/nikcli.db`, `:memory:`).
- The pragma set and the WAL checkpoint loop, including `NIKCLI_DISABLE_WAL_CHECKPOINT`.
- `DatabaseMigration.apply` and the migration journal (`src/database/migration*`).
- The synchronous singleton map and its `close` / `closeAll` / `isOpen` lifecycle, which tests rely
  on to release handles before a test home directory is removed.
- `afterCommit` semantics, until event publishing itself moves.

## Why Not Start With A Domain Store

A session or message store is a useful seam, but it does not answer the adapter problem: how to make
Drizzle SQLite Effect-native in this repo. Vendoring the adapter once lets the storage wrapper,
`SyncEvent`, and every domain `*.sql.ts` share one transaction and migration model instead of each
growing its own Effect bridge.

## Risks

- **The singleton is load-bearing for tests.** `bun test` swaps `NIKCLI_TEST_HOME` per file, and
  path-holding singletons must re-resolve on access. An adapter that caches a client in module scope
  reintroduces the stale-path class of failure.
- **Two clients open at once.** During step 5 the wrapper and the adapter must not both open the same
  file with different pragmas. The wrapper owns `open`; the adapter receives the handle.
- **Migration claiming is still in-process only.** `DatabaseMigration.apply` is protected by an
  in-process guard, so two processes starting against one `nikcli.db` can still race. That is a
  pre-existing gap, not one this package introduces, but it should not be made worse.

## Open Questions

- How much source is copied from the Drizzle branch versus imported from `drizzle-orm` internals?
- What is the update path once upstream Drizzle ships `effect-sqlite` for real?
- Should the compatibility wrapper keep synchronous return types indefinitely, or should a later pass
  force Effect call sites? Default answer: keep them, and let call sites migrate individually.
- Do CLI/admin raw SQL and the sqlite shell stay in `packages/nikcli`? Default answer: yes —
  `Database.syncNative()` is documented as admin/debug only and should not become package surface.
