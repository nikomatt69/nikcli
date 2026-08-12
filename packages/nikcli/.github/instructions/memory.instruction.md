# Nikcli Project Memory

**Last updated**: 2026-07-28 (Brain pass; merged architecture map + verified risk audit)

## Start Here

nikcli is an AI coding-agent runtime and OpenCode fork maintained by `nikomatt69`. It uses Bun, Effect HttpApi, Solid/OpenTUI, Vercel AI SDK, SQLite/Drizzle, and an ongoing Effect 4 service migration. The main package is `packages/nikcli`.

- The default branch is **`live-main`** (both `AGENTS.md` files now agree).
- The root workspace has about 30 packages; key packages are `nikcli`, `sdk`, `mobile`, `desktop`, `web`, `plugin`, `remote`, `companion`, `llm`, `tui-image`, and `terminal-control`.
- Use Bun only. In `packages/nikcli`: `bun run typecheck`, `bun test`, `bun run build`.
- Do not echo secrets: repo-root `nikcli.json` contains a real `nkm_*` bearer token. Treat it as sensitive.

**Package scale (2026-07-28 audit)**: 792 TS source files (~204k lines), 277 test files (~46k lines), 105 direct deps. Largest areas: `cli` 77k, `server` 27k, `session` 15k, `tool` 11k. Top 6 modules = ~43% of all code (power-law).

**Skills & docs**: A 959-line skill lives at `/Volumes/SSD/Projects/nikcli/.nikcli/skill/nikcli-skill/SKILL.md` covering quick reference, architecture, tools, server API, MCP, plugins, CLI, debugging, code examples, and best practices.

## Core Architecture

- `bin/nikcli:8` resolves the platform binary; dev runs `src/index.ts` (package.json:25). `src/index.ts:74` builds the yargs command graph; default command is `TuiThreadCommand` at `src/cli/cmd/tui/thread.ts:151`.
- TUI default flow: parent process spawns an isolated worker (`thread.ts:183`); worker hosts `Server.App` via `Rpc.listen(rpc)` at `src/cli/cmd/tui/worker.ts:116`, keeping domain/server state off the OpenTUI render thread. UI mounts at `app.tsx:113`; `SDKProvider` at `app.tsx:162` is the principal backend boundary.
- Default TUI uses direct worker RPC; `--port`/`--hostname` enables real HTTP; `nikcli attach` (attach.ts:3) uses a remote server without a worker; `nikcli serve` (cmd/serve.ts:73) is the headless path.
- The production agent loop is `SessionPrompt.loop()` (src/session/prompt.ts:686, ~2,538 lines). `SessionProcessor` (src/session/processor.ts:156) translates stream events into message parts, tool states, retries, snapshots, and bus updates.
- Sessions persist through v1 `Session`/`MessageV2` via `Session.Service` (src/session/index.ts:841, Effect layer at :885). `src/session/v2/` is a read-side/reducer migration layer; it has not replaced the production loop.
- Tools use `Tool.define()` (src/tool/tool.ts:122) and return `{ title, metadata, output, attachments? }`. Validation is Zod; the wrapper converts Promise/Effect implementations, applies truncation (2,000 lines / 50 KB), and supports `ctx.ask()` permissions.
- `ToolRegistry.Service` (src/tool/registry.ts:199, :289) combines built-ins, feature flags, plugins, and opt-in pinned custom tools. `resolveTools` (src/session/tools.ts:194) adds permissions, deadlines, session metadata, AI SDK adapters.
- `Provider.Service` (src/provider/provider.ts:1250; Effect impl at :2078) owns per-instance provider/model/SDK caches. `LLM.stream` (src/session/llm.ts:254, :479) picks native `@nikcli-ai/llm` or AI SDK fallback.
- Server is Effect HttpApi on Bun.serve (src/server/) with REST, SSE, WebSockets, OpenAPI, and workspace-aware request context. TUI/server communication uses generated `@nikcli-ai/sdk/httpapi`.
- Per-request flow: `Server.App` applies errors/auth/CORS/global routing, resolves workspace + directory, enters `WorkspaceContext.provide` + `withInstanceAsync` (src/server/server.ts:389). Legacy ambient scope is `Instance.provide` (src/project/instance.ts:32).

## Effect Migration Status

Substantial at the service-definition layer: session, provider, tools, permissions, question, config, agent, plugin, database, storage, MCP, file, sync, and worktree expose `Context.Service` interfaces. 265 files import Effect.

- Shared infrastructure: `ManagedRuntime`, shared layer memoization, observability, redirected Effect logging in `src/effect/runtime.ts:7`; per-directory scoped caches in `src/effect/instance-state.ts:31`.
- Instance context is dual-stack: `InstanceRef`/`WorkspaceRef` (src/effect/instance-ref.ts:14) provide fiber-local context, but `InstanceState.context` falls back to legacy ambient `Instance` (src/effect/instance-state.ts:5). `withInstanceAsync` (src/effect/with-instance.ts:30) is an explicit compatibility adapter until a keyed scoped runtime replaces the promise cache.
- HTTP migration is bridge-stage: `ServerBackend.decide` (src/server/backend.ts:99) selects Hono unless the experimental flag and route coverage allow Effect HttpApi. Pure Bun/Effect server (src/server/backend-runtime.ts:1) is explicitly a proof of concept.
- HttpApi coverage is broad for JSON; raw handlers retained for SSE, prompts, webhooks (`HttpApiBridge.handle`, src/server/httpapi/bridge.ts:330). WebSocket, sync streaming, companion, and mobile are explicitly blocked from Hono deletion (backend.ts:80).
- Domain internals still mixed: many services wrap Promise with `Effect.tryPromise`; SQLite repos are synchronous singletons; `SessionPrompt` and `LLM.stream` remain async-first.

## Data, Sync, And Workspaces

- Persistence is hybrid: central SQLite (`src/database/`, `nikcli.db`, WAL-configured, migrated at open in `src/database/database.ts:35`) plus filesystem JSON `Storage` (src/storage/storage.ts:59; 5-second cache, in-process `Lock`, cross-process `Flock`).
- Unified sync: `src/sync/` uses `sync_event` as the event log with projector, reducer, snapshots, outbox. Key migrations: `20260630000000_sync_unify` and `20260630000100_workspace_drop_events`.
- Distinguish three meanings of "sync": the `sync_event` log, `Workspace.startSyncing()` SSE loops, and Cloud push/pull. They are not interchangeable.
- Workspace backends are transparent to clients: `Workspace.get()` plus adaptor `target()` resolves local vs remote; server middleware proxies remote requests. Built-in adaptors are worktree and container.
- No ETag/`If-Match` optimistic-concurrency scheme; concurrency relies on locks, WAL, and sequence reservation.
- Optional Railway hub remote sync uses `s.nikcli.store`, `NIKCLI_REMOTE_URL`, `NIKCLI_REMOTE_TOKEN`. TUI exposes `/sync` and `<leader>y` via `RemoteSync` and `DialogSync`; routes include `/sync/stats`, `/sync/connect`, `/sync/disconnect`, `/sync/drain`.

## Agents, Delegation, And Testing

- Built-in primary agents: `build` (default), `plan`, `ralph`. Subagents: `explore`, `fast-explore`, `planner`, `researcher`, `code-reviewer`, `debugger`, `test-runner`, `refactor`, hidden `delegator`.
- `task` defaults to background, concurrency-limited; records are durable; completion wakes the parent with a synthetic prompt. Use `delegation` for list/read/cancel and `delegator` only for early progress/status.
- Long-running builds, typechecks, test suites, installs, servers must use `monitor`, not blocking bash.
- Bun tests live under `packages/nikcli/test/`, mirror `src/`. Sync/workspace suite last known green 2026-06-30: 17 tests across four files.
- After changing Hono endpoints, regenerate `packages/sdk/js` via its build script.
- **Route coverage (2026-07-28)**: `bun run check:routes` passes — 187 bridge patterns, 187 Hono routes, 0 unsupported.

## Verified Risks: 2026-07-28 Audit

A focused code-reviewer + architecture-mapping pass produced prioritized, verified risks with file references:

- **P0 — Network servers default to unauthenticated access.** `Auth.authenticate()` returns an `open` principal when no password is configured (`src/server/httpapi/auth.ts:180`), regardless of bind address. `Server.listen()` defaults `mobileAuthRequired` to false (`src/server/server.ts:1138`). Binding to `0.0.0.0` exposes shell, PTY, files, config, sessions without credentials.
- **P1 — False transaction guarantees.** `Storage.transaction()` claims atomic all-or-nothing behavior but executes direct file writes without rollback (`src/storage/storage.ts:327`). For 3+ targets, each `using` lock in the loop is released before operations execute (`src/storage/storage.ts:368`). Mid-transaction failure can leave partial state.
- **P1 — Excessive concentration.** `src/session/prompt.ts` (2,538 lines) controls nearly every agent concern. `src/cli/cmd/tui/routes/session/index.tsx` (3,968 lines). High-conflict, hard-to-test change surfaces.
- **P2 — Query-token exposure.** `Auth.authenticate()` accepts `?token=` globally (`src/server/httpapi/auth.ts:152`); query tokens are principally needed for websocket/mobile transports. Tokens can leak through browser history, intermediary logs, copied URLs.
- **P2 — Dual HTTP implementations.** Hono routes and Effect HttpApi contracts coexist behind regex dispatch (`src/server/backend.ts`, `src/server/httpapi/bridge.ts`). Coverage tests reduce drift, but every behavior change can still require synchronized implementations and schemas.
- **P2 — Split persistence semantics.** Sessions/messages use SQLite repos while monitors, delegations, misc records use file storage. Cross-system ops aren't transactional; recovery semantics differ.
- **P2 — Background execution is process-bound.** Workers/delegators run as in-process loops in `src/tool/task.ts`. Persisted leases enable orphan detection, but process restart still abandons active computation.
- **P3 — Effect migration adapter-heavy.** 265 files import Effect, but 269 `process.env` references, 153 raw `fetch()` calls, 76 filesystem-importing files, many `runPromiseWithLayer` wrappers remain. Pays complexity costs from both styles.
- **P3 — Documentation drift.** `README.md:75` links to `specs/integration-master-plan.md` and `specs/ux-roadmap.md` — neither file exists. Several roadmap documents describe older migration state.

## Known Technical Work

- Database centralization is incomplete: several domain modules still expose legacy per-domain patterns while the target is one `nikcli.db` service.
- The `opentui` tool has a schema/input-transform bug: component collection fields such as `items`, `nodes`, and table arrays may validate as objects rather than arrays. Proposed fix is a discriminated Zod union plus actionable validation errors; not confirmed implemented.
- `/brain` and `/doctor` route review found unresolved risks: status polling mutates Brain throttle state, HTTP doctor includes a TTY check that fails headlessly, trigger exceptions can return undocumented 500s, doctor is mounted after project bootstrap despite not needing it.
- Windows CI has recurring Bun bin-remap failures after hoisted installs. Recommended mitigation is `bun install --force` in Windows jobs. When adding a root workspace, update `nix/node_modules.nix` fileset too (it must include `../github`).
- Avoid leaking query tokens in server logs; `server.ts` request logging can include token-bearing paths. `mobile/auth.ts` also needs constant-time token comparison.
- **Dual context model (ambient Instance + Effect InstanceRef)** can cause scope leaks or incorrect directory resolution when async work escapes its intended boundary.
- **`terminal-control bundle` requires ffmpeg** (not installed on this machine). Recording works; bundle generation fails until ffmpeg is added via brew or equivalent.

## OAuth Review: 2026-07-17

A final code review of uncommitted OAuth-onboarding work found three actionable issues. A follow-up implementation task started but did not report completion or verification, so treat these as **unverified/in progress**:

1. `packages/nikcli/src/cli/cmd/tui/app.tsx:435`: `DialogLogin.run()` result can be ignored after Escape, allowing TUI startup without a verified local session. Startup should loop until `UserDB.verifySession(...)` succeeds.
2. `packages/nikcli/src/account/index.ts:389-445`: OAuth cancellation does not abort polling sleeps or the `/userinfo` fetch, so a cancelled flow can persist a profile. Use abort-aware delay/fetch and recheck before persistence.
3. `packages/identity/src/database.ts:30`: an existing provider/subject returns without refreshing its verified email. Update the linked account with normalized verified email before returning.

Focused tests should cover session-gated onboarding, cancellation during polling/userinfo, and existing-identity email refresh before declaring this work complete.

## Mobile UI/UX Notes

`packages/mobile` is Expo/React Native with NativeWind, Expo Router, Zustand, SecureStore, and a direct `MobileClient` data layer. Existing durable polish targets:

- Fix `SessionComposer` stop action: `onStop` is accepted but was not wired; several model/MCP props are also unused.
- Add semantic color tokens and improve `InfoChip` warning mapping; current warning colors can look like danger, especially in dark mode.
- Add accessibility role, label, and hint to icon-only pressables; give `ActionButton` a default button role/state.
- Remove nested `SafeAreaView` behavior in terminal route and guard retained terminal tabs against a disconnected client.
- Keep the planned direction: stronger semantic tokens, contextual header/tab states, consistent loading/empty/error patterns, cleaner transcript/tool/permission states, and better safe-area handling.

## Reference Facts

- OpenCode upstream reference branch is `anomalyco/opencode:dev`.
- The root `AGENTS.md` contains stale package/branch claims; verify live workspace state rather than copying them forward.
- Session transcript text is in SQLite (`message_info`, `message_part`); `session_diff/*.json` files may only be empty `[]` stubs.
- Verification baseline (2026-07-28): `bun run typecheck` passes (exit 0); `bun run check:routes` passes (187/187 routes bridged).
- OpenTUI dashboard schemas documented in the nikcli-skill: `stat_grid` (label/value/color), `key_value` (key/value/status), `bar_chart` (label/value/color, value=number), `list` (primary/secondary/icon/status), `compare` (rows with label/left/right/winner), `gauge` (value/max/label/min/thresholds), `accordion` (sections with title/open/content/items), `diff` (before/after/mode/filetype/title), `code` (content/filetype/showLineNumbers), `markdown` (content), `sparkline_row` (rows with label/values/current), `tree` (nodes with label/status/children), `histogram` (bins with label/count), `heatmap` (rowLabels/colLabels/values 2D/colorScale), `line_chart` (series with name/values/color + labels/height/showAxis). Status fields accept "default"|"success"|"warning"|"error"|"info". Max `status_grid` items ≤48.
