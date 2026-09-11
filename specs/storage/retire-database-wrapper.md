# Retire the synchronous `Database` wrapper

| Field   | Value                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Status  | **In progress** — group 1 landed 2026-09-11; groups 2-4 not started                                                           |
| Scope   | `packages/nikcli/src/database/database.ts` and its 38 consumers                                                               |
| Buys    | One database access shape, so a repository's failure mode is visible in its type                                              |
| Depends | [effect-sqlite-package.md](./effect-sqlite-package.md) — the adapter has to exist before call sites can move onto it          |
| Tests   | `test/database/transaction-semantics.test.ts` (the two semantics), `test/database/wrapper-inventory.test.ts` (the count gate) |

## Goal

Remove production usages of the synchronous surface of `src/database/database.ts`:

- `Database.syncDb()`
- `Database.syncNative()`
- ~~`Database.use(...)`~~ — removed, group 1
- `Database.transaction(...)`
- ~~`Database.effect(...)`~~ — removed, group 1
- `Database.TxOrDb` / `Database.Tx` / `Database.Client` as parameter types

This is **not** a request to remove SQLite, Drizzle, or the `Database` module. The pragma set, the
path rule, the migration journal, the singleton lifecycle, and `Database.Service` stay. The target is
the callback-and-singleton **access shape** that sits in front of them.

It is also not one change. The end state is that a repository takes its executor as a parameter or
yields it from Effect context, and nothing reaches for a process-global handle mid-function.

## Why

Three properties follow from `syncDb()` being reachable from anywhere:

1. **Failure is invisible in the signature.** A repository function that calls `Database.syncDb()`
   has the same type as one that does not. Whether it touches the database is not part of its
   contract, so a caller cannot tell what it needs to provide or what it can fail on.
2. **Test isolation depends on a convention.** `bun test` swaps `NIKCLI_TEST_HOME` per file. The
   singleton re-resolves its path on access, which is what makes that work — but nothing enforces
   it. A future singleton that captures the path at module load reintroduces the stale-path class of
   failure silently.
3. ~~**The transaction context is ambient.**~~ Fixed in group 1. `transaction` now hands the body a
   `TransactionContext` whose `afterCommit` queues onto the enclosing transaction's own queue, so a
   function that defers work says so in its signature and cannot queue against a transaction it is
   not in.

None of these are live bugs. They are the reason the count below should shrink rather than grow.

## Current Inventory

Measured 2026-09-11 against `packages/nikcli/src`, **code only** — comments are stripped first,
because `database.ts` names the APIs it explains and a doc comment is not a call site.

Before group 1: 92 references / 39 files. After: **90 references across 39 files.**

`test/database/wrapper-inventory.test.ts` holds those numbers as a ceiling. The count may fall and
may not rise. When a group lands, lower the baseline in the same change; when a new call site is
genuinely required, raise it deliberately and say why rather than widening the tolerance.

| API                         | References | Notes                                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------- |
| `Database.syncDb()`         | 31         | 27 files. The bulk of the work.                                  |
| `Database.transaction(...)` | 22         | 9 files.                                                         |
| `Database.TxOrDb`           | 15         | 13 files. Type-only; moves with whatever replaces the executor.  |
| `Database.Service`          | 12         | 7 files. **Already the target shape** — not part of the removal. |
| `Database.defaultLayer`     | 6          | `analytics/rollup.ts` (5), `analytics/data.ts` (1).              |
| `Database.syncNative()`     | 2          | `analytics/analytics.ts`, `analytics/share.ts`.                  |
| `Database.effect(...)`      | 2          | One real call site plus its doc comment.                         |
| `Database.use(...)`         | 1          | One call site.                                                   |
| `Database.Client`           | 1          | One structural type alias.                                       |

The long tail is the encouraging part: `effect`, `use`, `Client`, and `syncNative` have **six call
sites between them**, and two of those four APIs have exactly one.

## Group 1: The Ambient Transaction Context

**Status: landed 2026-09-11.**

`Database.effect(fn)` had one production call site — `src/sync/sync-event.ts`, deferring event
publication until after the enclosing transaction commits — and `Database.use(...)` had one, in the
same file. That was the whole justification for the module-level `pending` queue, so the ambient
context could be replaced without touching any other domain.

What changed:

```ts
// before
Database.transaction((tx) => {
  Database.effect(() => publish(event)) // queues against whatever is open
})

// after
Database.transaction((tx, ctx) => {
  ctx.afterCommit(() => publish(event)) // queues against *this* transaction
})
```

- `Database.transaction` passes a `TransactionContext` as the body's second argument. A nested call
  receives a context over the **outer** queue, so nesting semantics are unchanged.
- `SyncEvent.process` takes the context as a required parameter rather than reaching for it, which
  is what makes "this only works inside a transaction" a type error instead of a convention.
- `Database.use` is gone; its one caller reads `Database.syncDb()` directly.
- The module-level queue still exists but is now private to `transaction` and unreachable from
  outside it.

What did not change: nested joins, drain-after-outermost-commit, no-drain-on-rollback, a throwing
effect logged rather than propagated, and `behavior: "immediate"`. The fence tests assert all five
and were written before the refactor.

`SyncEvent.run` depends on transaction composability and on
`behavior: "immediate"` for sequencing correctness — see
[effect-sqlite-package.md](./effect-sqlite-package.md) — so whatever replaces `pending` must keep
post-commit effects draining after the **outermost** commit, never on rollback, and never while the
write lock is held.

`test/database/transaction-semantics.test.ts` pins all of that, including the case that makes the
queue worth having: an effect queued inside a nested block does not fire when the inner block
returns, because firing there would publish before the outer write committed. It also pins that a
throwing effect is logged and does not undo the commit, and that `behavior: "immediate"` really does
take the write lock up front — asserted against a second connection with `busy_timeout = 0`, opened
from inside the transaction so there is no timing race.

## Group 2: Analytics

**Status: not started.**

`analytics/rollup.ts` and `analytics/data.ts` already provide `Database.defaultLayer` explicitly (6
references), which is the target pattern. `analytics/analytics.ts` and `analytics/share.ts` reach
past Drizzle to `Database.syncNative()` for raw SQL.

`syncNative` is documented as admin/debug only. Either those two queries move onto Drizzle, or the
raw-SQL need is acknowledged and given a named accessor that says so in its type. Do not leave a
general-purpose escape hatch open for two callers.

## Group 3: Domain Repositories

**Status: not started. Largest group.**

The `*repo.ts` / `*.sql.ts` pairs: `session/{repo,message-repo,todo-repo,diff-repo,goal-repo,
instruction-repo,pending}.ts`, `session/v2/*`, `loop/repo.ts`, `mission/repo.ts`, `monitor/repo.ts`,
`artifact/repo.ts`, `background/repo.ts`, `project/repo.ts`, `share/repo.ts`,
`permission/permission-repo.ts`, `mobile/repo.ts`.

Most already accept `tx: Database.TxOrDb = Database.syncDb()` — an executor parameter with a global
default. The parameter is the right shape; the default is what keeps the global reachable.

The move is mechanical and should be done one domain at a time: make the executor required, and let
the caller supply it. A domain is done when its repository module has zero `Database.` references
other than the executor type.

## Group 4: Sync And Workspace

**Status: not started.**

`sync/{index,outbox,remote-sync,snapshot,migrate-from-workspace}.ts`, `workspace/db.ts`,
`server/httpapi/sync.ts`, `share/{repo,share-next}.ts`, `user/users.ts`, `account/db.ts`,
`mobile/auth.ts`.

`sync/index.ts:105` defines `type Executor = Pick<Database.Client, "select" | "insert" | "delete">`,
which is the narrowest executor type in the codebase and a good model for the others: a repository
that only reads should not be handed something that can write.

Several files in this group already take `Database.Service` from Effect context. They are done; they
appear here only because they still import the namespace.

## What Stays

- `Database.Service`, `Database.layerFromPath`, `Database.defaultLayer` — the Effect surface is the
  destination, not the thing being removed.
- `Database.path()`, `Database.close()`, `Database.closeAll()`, `Database.isOpen()` — lifecycle, used
  by tests and shutdown. Zero production references today.
- `DatabaseMigration.apply` and the journal.
- The pragma set and the WAL checkpoint loop.

## Sequencing

1. ~~Group 1 (two call sites, one file) — removes the ambient transaction context.~~ **Done.**
2. Group 2 (analytics) — decides the raw-SQL question while it is still two callers. **Next.**
3. Land [effect-sqlite-package.md](./effect-sqlite-package.md) steps 1–5, so there is an Effect-native
   executor for groups 3 and 4 to move onto.
4. Group 3, one domain per change, each with its existing repository tests green.
5. Group 4.
6. Add the gate, then delete the synchronous exports.

Do not start group 3 before step 3. Moving 27 files onto a target that does not exist yet means
moving them twice.

## Risks

- **`bun test` isolation.** Every change in groups 3 and 4 touches a module that tests instantiate
  per file with a different `NIKCLI_TEST_HOME`. Run the domain's suite, not just typecheck.
- **Groups 3 and 4 are wide.** 27 files reach for `syncDb()`. The inventory gate stops the count
  growing; it does not stop a change from being large. One domain per change.
- **The baseline is a number in a test.** It only means something if it is lowered when a group
  lands. A group that lands without lowering it has left the gate measuring the wrong thing.
