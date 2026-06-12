# Effect loose ends

Small follow-ups that do not fit neatly into the main facade, route, tool, or schema migration checklists.

## Config / TUI

- [x] `config/tui.ts` - finish the internal Effect migration.
      Current branch path is `src/config/tui.ts`; `loadState`, `mergeFile`, `loadFile`, and `load` are `Effect.fn(...)` helpers, and TUI config loading uses `ConfigPaths.Service`. Covered by `bun run typecheck` and `bun test test/tui/util/scroll.test.ts`.
- [ ] `config/tui.ts` callers - merged into Phase F (entry boundaries; see `specs/integration-master-plan.md`). Reason: the active callers are `cli/cmd/tui/plugin/runtime.ts` `TuiConfig.get()` / `TuiConfig.waitForDependencies()` calls inside `Instance.provide({ fn: async () => ... })` blocks; they will flip when the surrounding TUI entrypoint moves to the unified `withInstance(...)` helper, not as a stand-alone migration.
- [x] `env/index.ts` - direct `Instance.state` removed. Reason: `process.env` is process-global and `Env.set` mutates it directly, so the per-instance ALS wrapper added no behavioural isolation. The module is now a thin wrapper around `process.env` and remains sync (the 24 callers in `provider/provider.ts` are themselves still plain `async function` impls, so a full `Env.Service` migration is deferred until those caller chains effectify in Phase F).

## ConfigPaths

- [x] `config/paths.ts` - split pure helpers from effectful helpers.
      Keep `fileInDirectory(...)` as a plain function.
- [x] `config/paths.ts` - add a `ConfigPaths.Service` for the effectful operations so callers do not inherit `AppFileSystem.Service` directly.
      Initial service surface should cover:
  - `projectFiles(...)`
  - `directories(...)`
  - `readFile(...)`
  - `parseText(...)`
- [x] `config/config.ts` - switch internal config loading from `Effect.promise(() => ConfigPaths.*(...))` to `yield* paths.*(...)` once the service exists.
      Done by attrition (verified 2026-06-12): `makeScopedState` consumes `ConfigPaths.Service` via `yield* paths.directories(...)`, and `git grep "Effect.promise(() => ConfigPaths"` has zero hits across `src/`. `loadState` itself no longer touches ConfigPaths (it uses the plain async `loadFile`).
- [x] `config/tui.ts` - switch TUI config loading from async `ConfigPaths.*` wrappers to the `ConfigPaths.Service`.
- [x] `config/migrate-tui-config.ts` - decision: leave as plain async. Reason: it is a one-shot migration helper called from `TuiConfig.loadState` exactly once per project; effectifying would require either threading a `ConfigPaths.Service` Effect through the migration body or wrapping every line in `Effect.runPromise`. Current shape (plain async + `Filesystem.*` + legacy `ConfigPaths.projectFiles` compat wrapper) is correct for a one-shot migration utility.

## Instance cleanup

- [ ] `project/instance.ts` - keep shrinking the legacy ALS / Promise cache after the remaining `Instance.*` callers move over.

## Notes

- Prefer small, semantics-preserving config migrations. Config precedence, legacy key migration, and plugin origin tracking are easy to break accidentally.
- When changing config loading internals, rerun the config and TUI suites first before broad package sweeps.
