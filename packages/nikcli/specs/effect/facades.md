# Facade removal checklist

Concrete inventory of the remaining async namespace facades in `packages/nikcli`.

Current status on this branch:

- `src/` has no service-local `makeRuntime(...)` facade sites. The only `makeRuntime(...)` matches are the shared helpers in `src/effect/runtime.ts`.
- Historical runtime-backed hotspots `src/npm/index.ts` and `src/cli/cmd/tui/config/tui.ts` are not present on this branch.
- The plain async namespace audit is complete for this checklist. Remaining async namespaces are either pure infrastructure/utility wrappers, transport/UI helpers, or separate service-candidate backlogs tracked outside facade removal.

Recent progress:

- `Question`, `PermissionNext`, and `ProviderAuth` no longer expose async compatibility exports.
- `Vcs` now has an Effect service shape and no async compatibility wrappers; `project/bootstrap.ts` and `server/server.ts` enter `Vcs.Service` through Effect boundaries.

## Priority hotspots

- `src/session/*` facade audits are complete for the service surfaces listed below.
- `Provider` compatibility exports have been removed on this branch.
- `src/project/instance.ts` remains part of the broader legacy instance-context transition tracked in `instance-context.md`.

## Historical Batches

These batch labels came from an older branch. On this branch, treat the checklist below and current `rg` evidence as authoritative rather than assuming every historical batch item is complete.

Low-risk batch candidates:

1. `src/pty/index.ts`
2. `src/skill/index.ts`
3. `src/project/vcs.ts`
4. `src/tool/registry.ts`
5. `src/auth/index.ts`

Caller-heavy batch candidates:

1. `src/config/config.ts`
2. `src/provider/provider.ts`
3. `src/file/index.ts`
4. `src/lsp/index.ts`
5. `src/mcp/index.ts`

Shared pattern:

- one service file exports async facade helpers, sometimes after the internal service shape already exists
- one or two route or CLI entrypoints call those facades directly
- tests call the facade directly and need to switch to `yield* svc.method(...)`
- once callers are gone, remove async facade exports and any now-unused runtime/boundary imports

## Done means

For each service, the facade removal work is complete only when all of these are true:

1. all production callers stop using `Namespace.method(...)` facade calls
2. all direct test callers stop using the facade and instead yield the service from context
3. the service file no longer has service-local runtime helpers
4. the service file no longer exports async compatibility facade helpers
5. `rg` for the migrated facade methods only finds the service implementation itself or unrelated names

## Caller templates

### Route handlers

Use one `AppRuntime.runPromise(Effect.gen(...))` body and yield the service inside it.

```ts
const value = await AppRuntime.runPromise(
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    return yield* pty.list()
  }),
)
```

If two service calls are independent, keep them in the same effect body and use `Effect.all(...)`.

### Plain async CLI or script entrypoints

If the caller is not itself an Effect service yet, still prefer one contiguous `AppRuntime.runPromise(Effect.gen(...))` block for the whole unit of work.

```ts
const skills = await AppRuntime.runPromise(
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const skill = yield* Skill.Service
    yield* auth.set(key, info)
    return yield* skill.all()
  }),
)
```

Only fall back to `AppRuntime.runPromise(Service.use(...))` for truly isolated one-off calls or awkward callback boundaries. Do not stack multiple tiny `runPromise(...)` calls in the same contiguous workflow.

This is the right intermediate state. Do not block facade removal on effectifying the whole CLI file.

### Bootstrap or fire-and-forget startup code

If the old facade call existed only to kick off initialization, call the service through the existing runtime for that file.

```ts
void BootstrapRuntime.runPromise(Vcs.Service.use((svc) => svc.init()))
```

Do not reintroduce a dedicated runtime in the service just for bootstrap.

### Tests

Convert facade tests to full effect style.

```ts
it.effect("does the thing", () =>
  Effect.gen(function* () {
    const svc = yield* Pty.Service
    const info = yield* svc.create({ command: "cat", title: "a" })
    yield* svc.remove(info.id)
  }).pipe(Effect.provide(Pty.defaultLayer)),
)
```

If the repo test already uses `testEffect(...)`, prefer `testEffect(Service.defaultLayer)` and `yield* Service.Service` inside the test body.

Do not route tests through `AppRuntime` unless the test is explicitly exercising the app runtime. For facade removal, tests should usually provide the specific service layer they need.

If the test uses `provideTmpdirInstance(...)`, remember that fixture needs a live `ChildProcessSpawner` layer. For services whose `defaultLayer` does not already provide that infra, prefer the repo-standard cross-spawn layer:

```ts
const infra = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(MyService.defaultLayer, infra))
```

Without that extra layer, tests fail at runtime with `Service not found: effect/process/ChildProcessSpawner`.

## Questions already answered

### Do we need to effectify the whole caller first?

No.

- route files: compose the handler with `AppRuntime.runPromise(Effect.gen(...))`
- CLI and scripts: use `AppRuntime.runPromise(Service.use(...))`
- bootstrap: use the existing bootstrap runtime

Facade removal does not require a bigger refactor than that.

### Should tests keep calling the namespace from async test bodies?

No. Convert them now.

The end state is `yield* svc.method(...)`, not `await Namespace.method(...)` inside `async` tests.

### Should we keep `runPromise` exported for convenience?

No. For this batch the goal is to delete the service-local runtime entirely.

### What if a route has websocket callbacks or nested async handlers?

Keep the route shape, but replace each facade call with `AppRuntime.runPromise(Service.use(...))` or wrap the surrounding async section in one `Effect.gen(...)` when practical. Do not keep the service facade just because the route has callback-shaped code.

### Should we use one `runPromise` per service call?

No.

Default to one contiguous `AppRuntime.runPromise(Effect.gen(...))` block per handler, command, or workflow. Yield every service you need inside that block.

Multiple tiny `runPromise(...)` calls are only acceptable when the caller structure forces it, such as websocket lifecycle callbacks, external callback APIs, or genuinely unrelated one-off operations.

### Should we wrap a single service expression in `Effect.gen(...)`?

Usually no.

Prefer the direct form when there is only one expression:

```ts
await AppRuntime.runPromise(File.Service.use((svc) => svc.read(path)))
```

Use `Effect.gen(...)` when the workflow actually needs multiple yielded values or branching.

## Learnings

These were the recurring mistakes and useful corrections from the first two batches:

1. Tests should usually provide the specific service layer, not `AppRuntime`.
2. If a test uses `provideTmpdirInstance(...)` and needs child processes, prefer `CrossSpawnSpawner.defaultLayer`.
3. Instance-scoped services may need both the service layer and the right instance fixture. `File` tests, for example, needed `provideInstance(...)` plus `File.defaultLayer`.
4. Do not wrap a single `Service.use(...)` call in `Effect.gen(...)` just to return it. Use the direct form.
5. For CLI readability, extract file-local preload helpers when the handler starts doing config load + service load + batched effect fanout inline.
6. When rebasing a facade branch after nearby merges, prefer the already-cleaned service/test version over older inline facade-era code.

## Plain Async Namespace Audit

Audit run, 2026-05-06:

- `rg -n "export async function|export const [A-Za-z0-9_]+ = async|export function [A-Za-z0-9_]+" packages/nikcli/src --glob '*.ts'`
- `rg -n "makeRuntime\\(|ManagedRuntime\\.make\\(|runPromiseWithLayer\\(" packages/nikcli/src --glob '*.ts'`
- `rg -n "namespace .*\\{|export namespace" packages/nikcli/src --glob '*.ts'`

Decisions:

- Already migrated Effect services are represented by the per-service checked evidence below. Their compatibility exports remain removed.
- `Delegation`, `Brain`, `Sync`, `Workspace`, `SandboxRegistry`, `Monitor`, `BackgroundRun`, and mobile/TUI plugin runtime namespaces are not facade-cleanup leftovers; they are separate future service-candidate migrations if the project chooses to effectify those domains.
- `BunProc`, `PackageRegistry`, `Shell`, `Filesystem`, `Archive`, `Flock`, `Lock`, `EventLoop`, `StorageDB`, and similar utility namespaces are infrastructure wrappers, not service-local Effect facades. Some are tracked in `migration.md` utility-debt items instead.
- `Server`, `ServerProxy`, route modules, OAuth callback server helpers, websocket/SSE helpers, CLI UI helpers, and connector API wrappers are transport or UI boundaries. They should be migrated only as part of the `http-api.md` route plan or a dedicated UI/connector plan.
- Pure schema, DTO, formatter, parser, ID, locale, provider transform, and message conversion namespaces remain plain helpers.

## Remaining work

Most of the original facade-removal backlog is done. Remaining items are intentionally tracked elsewhere:

1. keep `src/project/instance.ts` in the separate instance-context migration, not this checklist
2. keep broad non-service utility rewrites in `migration.md`, not this checklist
3. keep route/transport migration in `http-api.md`, not this checklist

## Checklist

- [x] Current branch has no service-local `makeRuntime(...)` facade sites. Evidence: `rg -n "makeRuntime\\(" packages/nikcli/src` only reports `src/effect/runtime.ts`.
- [x] Historical hotspots `src/npm/index.ts` and `src/cli/cmd/tui/config/tui.ts` are not present on this branch. Evidence: `find packages/nikcli/src -path '*npm*' -o -path '*cli/cmd/tui/config*'` returns no files.
- [x] Audit plain async namespace facades that are not `makeRuntime(...)`-backed and decide case-by-case whether they should become Effect services. Evidence: Plain Async Namespace Audit section above.
- [x] `src/question/index.ts` (`Question`) - async compatibility exports removed; production callers now enter `Question.Service` through Effect boundaries. Evidence: `rg -n "Question\\.(ask|reply|reject|list)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/permission/next.ts` (`PermissionNext`) - async compatibility exports removed; production callers now enter `PermissionNext.Service` through Effect boundaries. Evidence: `rg -n "PermissionNext\\.(ask|reply|list|hydrateAsk|hydrateReply)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/provider/auth.ts` (`ProviderAuth`) - async compatibility exports removed; production callers now enter `ProviderAuth.Service` through Effect boundaries. Evidence: `rg -n "ProviderAuth\\.(methods|api|authorize|callback)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/format/index.ts` (`Format`) - async compatibility exports removed; `project/bootstrap.ts` and `server/server.ts` now enter `Format.Service` through Effect boundaries. Evidence: `rg -n "Format\\.(init|status)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/file/watcher.ts` (`FileWatcher`) - async compatibility export removed; `project/bootstrap.ts` now enters `FileWatcher.Service` through an Effect boundary. Evidence: `rg -n "FileWatcher\\.init\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/tool/truncation.ts` (`Truncate`) - async compatibility exports removed; callers now enter `Truncate.Service` through Effect boundaries. Evidence: `rg -n "Truncate\\.(init|cleanup|output)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/installation/index.ts` (`Installation`) - async compatibility exports for `info/method/latest/upgrade` removed; upgrade and uninstall callers now enter `Installation.Service` through Effect boundaries. Evidence: `rg -n "Installation\\.(info|method|latest|upgrade)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/session/status.ts` (`SessionStatus`) - sync compatibility exports for `get/list/set/hydrate` removed; callers now enter `SessionStatus.Service` through Effect boundaries. Evidence: `rg -n "SessionStatus\\.(get|list|set|hydrate)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/mcp/auth.ts` (`McpAuth`) - async compatibility exports for credential operations removed; MCP, OAuth provider, and CLI callers now enter `McpAuth.Service` through Effect boundaries. Evidence: `rg -n "McpAuth\\.(get|getForUrl|all|set|remove|updateTokens|updateClientInfo|updateCodeVerifier|clearCodeVerifier|updateOAuthState|getOAuthState|clearOAuthState|isTokenExpired)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/account/index.ts` (`Account`) - async/sync compatibility exports for account operations removed; CLI account callers now enter `Account.Service` through Effect boundaries. Evidence: `rg -n "Account\\.(login|poll|loginFull|token|orgs|active|get|list|use|remove|config)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/auth/index.ts` (`Auth`) - async compatibility exports for credential operations removed; credential callers now enter `Auth.Service` through Effect boundaries. Evidence: `rg --pcre2 -n "(?<!Connector)(?<!Mobile)Auth\\.(getValid|refresh|get|all|set|remove|fetchWellKnown|fetchWellKnownToken)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/snapshot/index.ts` (`Snapshot`) - async compatibility exports for snapshot operations removed; session, bootstrap, summary/revert, and debug callers now enter `Snapshot.Service` through Effect boundaries. Evidence: `rg -n "Snapshot\\.(init|cleanup|track|patch|restore|revert|diff|diffFull)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/connectors/auth.ts` (`ConnectorAuth`) - async compatibility exports for connector credential operations removed; connector callers now enter `ConnectorAuth.Service` through Effect boundaries. Evidence: `rg -n "ConnectorAuth\\.(get|all|set|remove|updateToken|updateBotToken|updateApiKey|isTokenExpired)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/project/project.ts` (`Project`) - async compatibility exports for `fromDirectory/discover/setInitialized/list/update/sandboxes/removeSandbox` removed; instance, bootstrap, routes, server, mobile, CLI, and E2E seed callers now enter `Project.Service` through Effect boundaries. Evidence: `rg -n "Project\\.(fromDirectory|list|update|setInitialized|sandboxes|removeSandbox|discover)\\(" packages/nikcli/src packages/nikcli/test packages/nikcli/script` returns no matches.
- [x] `src/session/index.ts` (`Session`) - async compatibility exports for create/fork/touch/createNext/plan/get/getAnyProject/getShare/share/unshare/update/diff/messages/list/children/remove/message mutation/initialize operations removed; production, script, and test callers now enter `Session.Service` through Effect boundaries. Evidence: `rg -n "Session\\.(create|fork|touch|createNext|plan|get|getAnyProject|getShare|share|unshare|update|diff|messages|list|children|remove|removeMessageWithParts|updateMessage|removeMessage|removePart|updatePart|initialize)(\\.|\\()" packages/nikcli/src packages/nikcli/test packages/nikcli/script` returns no matches.
- [x] `src/session/prompt.ts` (`SessionPrompt`) - async/sync compatibility exports for `prompt/command/shell/cancel/loop/resolvePromptParts/assertNotBusy/state` removed; session, tool, delegation, monitor, mobile, brain, and server route callers now enter `SessionPrompt.Service` through Effect boundaries. Evidence: `rg -n "SessionPrompt\\.(prompt|command|shell|cancel|loop|resolvePromptParts|assertNotBusy|state)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/session/summary.ts` (`SessionSummary`) - async compatibility exports for `summarize/diff/computeDiff` removed; processor, prompt, revert, mobile, and session route callers now enter `SessionSummary.Service` through Effect boundaries. Evidence: `rg -n "SessionSummary\\.(summarize|diff|computeDiff|diff\\.schema)" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/session/revert.ts` (`SessionRevert`) - async compatibility exports for `revert/unrevert/cleanup` removed; prompt, session route, and lifecycle test callers now enter `SessionRevert.Service` through Effect boundaries. Evidence: `rg -n "SessionRevert\\.(revert|unrevert|cleanup)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/session/compaction.ts` (`SessionCompaction`) - async compatibility exports for `isOverflow/editContext/prune/process/create` removed; processor, prompt, session route, and audit tests now enter `SessionCompaction.Service` through Effect boundaries. Evidence: `rg -n "SessionCompaction\\.(isOverflow|editContext|prune|process|create)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/session/system.ts` (`SystemPrompt`) - async compatibility exports for `environment/custom/skills` removed; prompt assembly now enters `SystemPrompt.Service` through an Effect boundary. Pure `header/instructions/provider` helpers remain as static prompt selectors. Evidence: `rg -n "SystemPrompt\\.(environment|custom|skills)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/session/todo.ts` (`Todo`) - async compatibility exports for `get/update/init` removed; todo tool, session route, bootstrap, and tests now enter `Todo.Service` through Effect boundaries. Evidence: `rg -n "Todo\\.(update|get|init)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/share/share-next.ts` (`ShareNext`) - async compatibility exports for `url/init/create/remove/publicData` removed; session, bootstrap, route, server, and CLI callers now enter `ShareNext.Service` through Effect boundaries. Evidence: `rg -n "ShareNext\\.(url|init|create|remove|publicData)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/agent/agent.ts` (`Agent`) - async compatibility exports for `get/list/defaultAgent/generate` removed; session, task, CLI, ACP, and server callers now enter `Agent.Service` through Effect boundaries. Evidence: `rg -n "Agent\\.(get|list|defaultAgent|generate)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/permission/index.ts` (`Permission`) - unused legacy facade removed; active permission surface is `src/permission/next.ts`.
- [x] `src/command/index.ts` (`Command`) - async compatibility exports for `get/list` removed; callers now enter `Command.Service` through Effect boundaries. Evidence: `rg -n "Command\\.(get|list)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/worktree/index.ts` (`Worktree`) - async compatibility exports for `create/remove/reset/list` removed; workspace adaptor and route callers now enter `Worktree.Service` through Effect boundaries. Evidence: `rg -n "Worktree\\.(create|remove|reset|list)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/plugin/index.ts` (`Plugin`) - async compatibility exports for `trigger/list/init` removed; provider auth, provider loading, session auth, bootstrap, LLM, prompt, processor, chatbot, and tool registry callers now enter `Plugin.Service` through Effect boundaries. Evidence: `rg -n "Plugin\\.(trigger|list|init)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/storage/storage.ts` (`Storage`) - async compatibility exports for `read/write/update/remove/list` removed; production and test callers now enter `Storage.Service` through Effect boundaries. Evidence: `rg -n "Storage\\.(remove|read|update|write|list)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/snapshot/index.ts` (`Snapshot`) - service-local facades removed; see current checked `Snapshot` evidence above.
- [x] `src/file/index.ts` (`File`) - async compatibility exports for `init/status/read/list/search` removed; project bootstrap, file routes, and debug CLI now enter `File.Service` through Effect boundaries. Evidence: `rg -n "File\\.(init|status|read|list|search)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/lsp/index.ts` (`LSP`) - async compatibility exports for `init/status/hasClients/touchFile/diagnostics/hover/workspaceSymbol/documentSymbol/definition/references/implementation/prepareCallHierarchy/incomingCalls/outgoingCalls` removed; project bootstrap, server status route, LSP debug CLI, session prompt, and LSP-dependent tools now enter `LSP.Service` through Effect boundaries. Evidence: `rg -n "LSP\\.(init|status|hasClients|touchFile|diagnostics|hover|workspaceSymbol|documentSymbol|definition|references|implementation|prepareCallHierarchy|incomingCalls|outgoingCalls)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/mcp/index.ts` (`MCP`) - async compatibility exports for `add/status/clients/connect/disconnect/tools/prompts/resources/getPrompt/readResource/startAuth/authenticate/finishAuth/removeAuth/supportsOAuth/hasStoredTokens/getAuthStatus` removed; routes, CLI, command prompt loading, and session prompt MCP resource/tool callers now enter `MCP.Service` through Effect boundaries. Evidence: `rg -n "MCP\\.(add|status|clients|connect|disconnect|tools|prompts|resources|getPrompt|readResource|startAuth|authenticate|finishAuth|removeAuth|supportsOAuth|hasStoredTokens|getAuthStatus)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/config/config.ts` (`Config`) - async compatibility exports for `state/get/getGlobal/update/updateGlobal/directories/global` removed; production and test callers now enter `Config.Service` through Effect boundaries. Evidence: `rg --pcre2 -n "(?<!Tui)Config\\.(get|update|getGlobal|updateGlobal|global|state|directories)\\(" packages/nikcli/src packages/nikcli/test packages/nikcli/script` returns no matches; `rg -n "export function (state|get|getGlobal|update|updateGlobal|directories)\\b|export const global\\b" packages/nikcli/src/config/config.ts` returns no matches.
- [x] `src/provider/provider.ts` (`Provider`) - async compatibility exports for `list/getProvider/getModel/getLanguage/getImageModel/closest/getSmallModel/defaultModel` removed; production and test callers now enter `Provider.Service` through Effect boundaries. Evidence: `rg -n "Provider\\.(list|getProvider|getModel|getLanguage|getImageModel|closest|getSmallModel|defaultModel)\\(" packages/nikcli/src packages/nikcli/test packages/nikcli/script` returns no matches; `rg -n "export async function (list|getProvider|getModel|getLanguage|getImageModel|closest|getSmallModel|defaultModel)|function runProvider" packages/nikcli/src/provider/provider.ts` returns no matches.
- [x] `src/pty/index.ts` (`Pty`) - async compatibility exports removed; `server/routes/pty.ts` now enters `Pty.Service` through Effect boundaries, including websocket callbacks. Evidence: `rg -n "Pty\\.(list|get|create|update|remove|resize|write|connect)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/skill/skill.ts` (`Skill`) - async compatibility exports for stateful operations removed; production callers now enter `Skill.Service` through Effect boundaries. Evidence: `rg -n "Skill\\.(all|get|resolve|load|create|remove)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/project/vcs.ts` (`Vcs`) - async compatibility exports removed; `project/bootstrap.ts` and `server/server.ts` now enter `Vcs.Service` through Effect boundaries. Evidence: `rg -n "Vcs\\.(init|branch)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/tool/registry.ts` (`ToolRegistry`) - async compatibility exports removed; production callers now enter `ToolRegistry.Service` through Effect boundaries. Evidence: `rg -n "ToolRegistry\\.(register|ids|tools)\\(" packages/nikcli/src packages/nikcli/test` returns no matches.
- [x] `src/auth/index.ts` (`Auth`) - facades removed and merged; see current checked `Auth` evidence above.

## Excluded `makeRuntime(...)` sites

- `src/bus/index.ts` - core bus plumbing, not a normal facade-removal target.
- `src/effect/cross-spawn-spawner.ts` - runtime helper for `ChildProcessSpawner`, not a service namespace facade.
