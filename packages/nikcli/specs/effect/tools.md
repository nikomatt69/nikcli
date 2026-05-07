# Tool migration

Practical reference for the current tool-migration state in `packages/nikcli`.

## Status

`Tool.Def.execute` returns `Effect.Effect<Tool.Result<M>, Error>` on this branch (Phase J.0 landed 2026-05-07). `Tool.Def.executeAsync` is the compatibility Promise wrapper around `Effect.runPromise(execute(...))` so existing callers (`session/prompt.ts`, `tool/batch.ts`, `tool/multiedit.ts`, `tool/exec_code.ts`, `cli/cmd/debug/agent.ts`, `tool/registry.ts` `Resolved`) keep their `await tool.executeAsync(...)` shape until each call site migrates to `yield* tool.execute(...)`.

`Tool.define(...)` accepts authored bodies that return either `Promise<Tool.Result<M>>` or `Effect.Effect<Tool.Result<M>, Error>`; the wrapper auto-converts via `Effect.tryPromise(...)`. New tools should target the Effect shape directly. The built-in tool surface stays Promise-shaped at authoring level for now — flipping each tool body is incremental.

The current exported tools in `src/tool` all use `Tool.define(...)` with Effect-based initialization, and nearly all of them already build their tool body with `Effect.gen(...)` and `Effect.fn(...)`.

So the remaining work is no longer "convert tools to Effect at all". The remaining work is mostly:

1. remove Promise and raw platform bridges inside individual tool bodies
2. swap tool internals to Effect-native services like `AppFileSystem`, `HttpClient`, and `ChildProcessSpawner`
3. keep tests and callers aligned with `yield* info.init()` and real service graphs

## Current shape

`Tool.define(...)` is already the Effect-native helper here.

- `init` is an `Effect`
- `info.init()` returns an `Effect`
- `execute(...)` returns an `Effect`

That means a tool does not need a separate `Tool.defineEffect(...)` helper to count as migrated. A tool is effectively migrated when its init and execute path stay Effect-native, even if some internals still bridge to Promise-based or raw APIs.

## Tests

Tool tests should use the existing Effect helpers in `packages/nikcli/test/lib/effect.ts`:

- Use `testEffect(...)` / `it.live(...)` instead of creating fake local wrappers around effectful tools.
- Yield the real tool export, then initialize it: `const info = yield* ReadTool`, `const tool = yield* info.init()`.
- Run tests inside a real instance with `provideTmpdirInstance(...)` or `provideInstance(tmpdirScoped(...))` so instance-scoped services resolve exactly as they do in production.

This keeps tool tests aligned with the production service graph and makes follow-up cleanup mostly mechanical.

## Exported tools

These exported tool definitions currently use `Tool.define(...)` in `src/tool`:

- [ ] `apply_patch.ts`
- [ ] `bash.ts`
- [ ] `edit.ts`
- [ ] `glob.ts`
- [ ] `grep.ts`
- [ ] `invalid.ts`
- [ ] `lsp.ts`
- [ ] `plan.ts`
- [ ] `question.ts`
- [ ] `read.ts`
- [ ] `skill.ts`
- [ ] `task.ts`
- [ ] `todo.ts`
- [ ] `webfetch.ts`
- [ ] `websearch.ts`
- [ ] `write.ts`

Notes:

- There is no current `ls.ts` tool file on this branch.
- `truncate.ts` is an Effect service used by tools, not a tool definition itself.
- `registry.ts` is now an Effect service for resolving tool definitions; it is tracked in `migration.md` and `facades.md`, not in the exported tool-definition checklist below.
- `skill/skill.ts` is now an Effect service for skill discovery and CRUD; `tool/skill.ts` enters it through Effect boundaries.
- `mcp-exa.ts`, `external-directory.ts`, and `schema.ts` are support modules, not standalone tool definitions.

## Follow-up cleanup

Most exported tools are already on the intended Effect-native shape. The remaining cleanup is narrower than the old checklist implied.

Current spot cleanups worth tracking:

- [ ] `read.ts` — still bridges to Node stream / `readline` helpers and Promise-based binary detection
- [ ] `bash.ts` — already uses Effect child-process primitives; only keep tracking shell-specific platform bridges and parser/loading details as they come up
- [ ] `webfetch.ts` — already uses `HttpClient`; remaining work is limited to smaller boundary helpers like HTML text extraction
- [ ] `file/ripgrep.ts` — adjacent to tool migration; still has raw fs/process usage that affects `grep.ts` and file-search routes
- [ ] `patch/index.ts` — adjacent to tool migration; still has raw fs usage behind patch application

Notable items that are already effectively on the target path and do not need separate migration bullets right now:

- `apply_patch.ts`
- `grep.ts`
- `write.ts`
- `websearch.ts`
- `edit.ts`

## Filesystem notes

Current raw fs users on this branch (`rg -n "fs\\.|from \"fs|from \"fs/promises" src` audit, 2026-05-07):

- `tool/read.ts` — `fs.readdirSync` (single use, fuzzy file suggestion path); the `fs.createReadStream` / `readline` mention in older specs is stale.
- `file/searchBackend.ts` — `fs.realpath`, `fs.stat` (3 sites).
- `file/fff.ts` — `fs.realpath`, `fs.mkdir` (3 sites).
- `patch/index.ts` — `fs.mkdir`, `fs.writeFile`, `fs.unlink`, `fs.readFile` (8 sites).
- `file/ripgrep.ts` — does not exist on this branch; remove from spec inventory.

Migration prerequisite: the `searchBackend.ts` / `fff.ts` `fs.realpath` calls are tightly coupled to ambient `Instance.directory` / `Instance.worktree` reads. Migrating the `fs.*` half without first removing the `Instance.*` reads (Phase F of the master plan) would leave a half-migration. Defer until Phase F lands.
