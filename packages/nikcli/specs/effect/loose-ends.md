# Effect loose ends

Small follow-ups that do not fit neatly into the main facade, route, tool, or schema migration checklists.

## Config / TUI

- [x] `config/tui.ts` - finish the internal Effect migration.
      Current branch path is `src/config/tui.ts`; `loadState`, `mergeFile`, `loadFile`, and `load` are `Effect.fn(...)` helpers, and TUI config loading uses `ConfigPaths.Service`. Covered by `bun run typecheck` and `bun test test/tui/util/scroll.test.ts`.
- [ ] `config/tui.ts` callers - once the internal service is stable, migrate plain async callers to use `TuiConfig.Service` directly where that actually simplifies the code.
      Likely first callers: `cli/cmd/tui/attach.ts`, `cli/cmd/tui/thread.ts`, `cli/cmd/tui/plugin/runtime.ts`.
- [ ] `env/index.ts` - still uses legacy `Instance.state(...)`; migrate only together with the `Provider` caller path or another Effect boundary that can consume an `Env.Service`.

## ConfigPaths

- [x] `config/paths.ts` - split pure helpers from effectful helpers.
      Keep `fileInDirectory(...)` as a plain function.
- [x] `config/paths.ts` - add a `ConfigPaths.Service` for the effectful operations so callers do not inherit `AppFileSystem.Service` directly.
      Initial service surface should cover:
  - `projectFiles(...)`
  - `directories(...)`
  - `readFile(...)`
  - `parseText(...)`
- [ ] `config/config.ts` - switch internal config loading from `Effect.promise(() => ConfigPaths.*(...))` to `yield* paths.*(...)` once the service exists.
- [x] `config/tui.ts` - switch TUI config loading from async `ConfigPaths.*` wrappers to the `ConfigPaths.Service`.
- [ ] `config/migrate-tui-config.ts` - decide whether to leave this as a plain async module using wrapper functions or effectify it fully after `ConfigPaths.Service` lands.

## Instance cleanup

- [ ] `project/instance.ts` - keep shrinking the legacy ALS / Promise cache after the remaining `Instance.*` callers move over.

## Notes

- Prefer small, semantics-preserving config migrations. Config precedence, legacy key migration, and plugin origin tracking are easy to break accidentally.
- When changing config loading internals, rerun the config and TUI suites first before broad package sweeps.
