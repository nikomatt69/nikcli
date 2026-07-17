# Nikcli Project Memory

**Last updated**: 2026-07-17 (Brain pass; pruned and consolidated)

## Start Here

nikcli is an AI coding-agent runtime and OpenCode fork maintained by `nikomatt69`. It uses Bun, Hono, Solid/OpenTUI, Vercel AI SDK, SQLite/Drizzle, and an ongoing Effect 4 service migration. The main package is `packages/nikcli`.

- The actual default branch is **`live-main`**. References to `dev` or `nikoemme-main` in `AGENTS.md` are stale.
- The root workspace has about 30 packages; key packages are `nikcli`, `sdk`, `mobile`, `desktop`, `web`, `plugin`, `remote`, `companion`, `llm`, `tui-image`, and `terminal-control`.
- Use Bun only. In `packages/nikcli`: `bun run typecheck`, `bun test`, `bun run build`.
- Do not echo secrets: repo-root `nikcli.json` contains a real `nkm_*` bearer token. Treat it as sensitive.

## Core Architecture

- `src/index.ts` is the yargs CLI entrypoint. `src/cli/bootstrap.ts` runs commands in a project `Instance`.
- The production agent loop is `SessionPrompt.loop()` in `src/session/prompt.ts`; `SessionProcessor` performs one streamed model/tool turn. `src/agent/` defines profiles and prompts, not the loop.
- Sessions persist through the v1 `Session`/`MessageV2` model. `src/session/v2/` is a read-side/reducer migration layer; it has not replaced the production loop.
- Tools use `Tool.define()` and return `{ title, metadata, output, attachments? }`. Validation is Zod; the wrapper converts Promise/Effect implementations, applies truncation (2,000 lines / 50 KB), and supports `ctx.ask()` permissions.
- `Tool.Context` is created per call. Tool discovery combines built-ins, config-directory tools, plugins, and MCP tools.
- The TUI is Solid + OpenTUI in `src/cli/cmd/tui/`: `thread.ts` launches/coordinates the worker, `worker.ts` hosts the server/RPC surface, and `app.tsx` renders the provider tree. Default TUI uses direct worker RPC; `--port`/`--hostname` enables real HTTP; `nikcli attach` uses a remote server without a worker.
- Server is Hono on Bun (`src/server/server.ts`) with REST, SSE, WebSockets, OpenAPI, and workspace-aware request context. TUI/server communication goes through generated `@nikcli-ai/sdk/v2`, not ad hoc self-HTTP calls.

## Data, Sync, And Workspaces

- Persistence is hybrid: central SQLite (`src/database/`, `nikcli.db`) plus filesystem JSON `Storage` for remaining side state. SQLite is WAL-backed; JSON storage has 5-second cache, in-process `Lock`, and cross-process `Flock` where needed.
- Unified sync is the current architectural focus: `src/sync/` uses `sync_event` as the event log with projector, reducer, snapshots, and outbox. Key migrations: `20260630000000_sync_unify` and `20260630000100_workspace_drop_events`.
- Distinguish three meanings of “sync”: the `sync_event` log, `Workspace.startSyncing()` SSE loops, and Cloud push/pull. They are not interchangeable.
- Workspace backends are transparent to clients: `Workspace.get()` plus adaptor `target()` resolves local versus remote, and server middleware proxies remote requests. Built-in adaptors are worktree and container.
- There is no ETag/`If-Match` optimistic-concurrency scheme; concurrency relies on locks, WAL, and sequence reservation.
- Optional Railway hub remote sync uses `s.nikcli.store`, `NIKCLI_REMOTE_URL`, and `NIKCLI_REMOTE_TOKEN`. The TUI exposes `/sync` and `<leader>y` through `RemoteSync` and `DialogSync`; server routes include `/sync/stats`, `/sync/connect`, `/sync/disconnect`, and `/sync/drain`.

## Agents, Delegation, And Testing

- Built-in primary agents: `build` (default), `plan`, and `ralph`; common subagents include `explore`, `fast-explore`, `planner`, `researcher`, `code-reviewer`, `debugger`, `test-runner`, `refactor`, and hidden `delegator`.
- `task` defaults to background and is concurrency-limited. Background records are durable; completion wakes the parent with a synthetic prompt. Use `delegation` for list/read/cancel and `delegator` only for early progress/status.
- Long-running builds, typechecks, test suites, installs, and servers must use `monitor`, not blocking bash.
- Bun test files live under `packages/nikcli/test/` and generally mirror `src/`. Sync/workspace suite was last known green on 2026-06-30: 17 tests across four files.
- After changing Hono endpoints, regenerate `packages/sdk/js` via its build script so generated SDK types stay aligned.

## Known Technical Work

- Database centralization is incomplete: several domain modules still expose legacy per-domain patterns while the target is one `nikcli.db` service.
- The `opentui` tool has a schema/input-transform bug: component collection fields such as `items`, `nodes`, and table arrays may validate as objects rather than arrays. Proposed fix is a discriminated Zod union plus actionable validation errors; not confirmed implemented.
- `/brain` and `/doctor` route review found unresolved risks: status polling mutates Brain throttle state, HTTP doctor includes a TTY check that fails headlessly, trigger exceptions can return undocumented 500s, and doctor is mounted after project bootstrap despite not needing it.
- Windows CI has recurring Bun bin-remap failures after hoisted installs. Recommended mitigation is `bun install --force` in Windows jobs. When adding a root workspace, update `nix/node_modules.nix` fileset too (it must include `../github`).
- Avoid leaking query tokens in server logs; `server.ts` request logging can include token-bearing paths. `mobile/auth.ts` also needs constant-time token comparison.

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
