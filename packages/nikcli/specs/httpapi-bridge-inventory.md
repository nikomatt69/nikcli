# HttpApi bridge inventory (Hono vs `implementedRoutes`)

Audit date: 2026-06-18. Source of truth for bridged paths: `src/server/httpapi/bridge.ts` (`implementedRoutes` + `handle()` specials).

When `NIKCLI_EXPERIMENTAL_HTTPAPI=1`, `server.ts` forwards to `HttpApiBridge.handle` only if `HttpApiBridge.supports(path, method)` is true; otherwise Hono handles the request.

## Special handling (not only regex table)

| Method | Path pattern                | Mechanism                               | `supports()`        |
| ------ | --------------------------- | --------------------------------------- | ------------------- |
| GET    | `/event`                    | `HttpApiEvent.handle()` in `handle()`   | yes (`/^\/event$/`) |
| POST   | `/session/:id/message`      | `HttpApiPrompt.prompt` (streaming body) | yes                 |
| POST   | `/session/:id/prompt_async` | `HttpApiPrompt.promptAsync`             | yes                 |

Session v2 reads are in `implementedRoutes` and `SessionHttpApi` handlers (`public.ts`).

TUI control paths are in `implementedRoutes` and `TuiHttpApi` (`httpapi/tui.ts`).

## Bridged groups (HttpApi / regex)

Rough coverage — desktop instance API paths that **do not** fall through to Hono when the flag is on:

| Prefix / group                                                           | HttpApi module                       | Notes                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/agent`, `/command`, `/skill`, `/lsp`, `/formatter`, `/path`, `/vcs`    | top-level / mixed                    | VCS **mutations** (`vcs.apply`, `vcs.status`, `vcs.diff.raw`) still Hono-only in `server.ts` |
| `/config`, `/profiles`                                                   | `httpapi/config`, profiles in public | MCP config patch routes bridged                                                              |
| `/project`                                                               | `httpapi/project`                    |                                                                                              |
| `/provider`                                                              | `httpapi/provider`                   | OAuth authorize/callback bridged                                                             |
| `/permission`, `/question`                                               | `httpapi/*`                          |                                                                                              |
| `/session` (subset)                                                      | `httpapi/session`                    | See **Session gaps** below                                                                   |
| `/mcp`                                                                   | `httpapi/mcp`                        | OAuth MCP auth routes bridged                                                                |
| `/find`, `/file`                                                         | `httpapi/file`                       |                                                                                              |
| `/experimental/tool`, `/experimental/worktree`, `/experimental/resource` | `httpapi/experimental`               |                                                                                              |
| `/experimental/workspace/*`                                              | `httpapi/workspace`                  | incl. `sync-list`, `warp`, restore                                                           |
| `/instance/dispose`                                                      | top-level                            |                                                                                              |
| `/tui/*` (listed paths)                                                  | `httpapi/tui`                        | Same queues as Hono `routes/tui.ts`                                                          |
| `/loop`                                                                  | `httpapi/loop`                       | CRUD, run/abort/pause/resume, generate, templates, runs                                      |

Count: **122** regex entries in `implementedRoutes` (see `bridge.ts`), including full `/loop` group (`httpapi/loop.ts`).

## Session — bridged vs Hono-only

| Operation (OpenAPI)                                                | Typical path               | Bridge                        |
| ------------------------------------------------------------------ | -------------------------- | ----------------------------- |
| list, status, get, children, todo, create, delete, update, fork    | `/session...`              | bridged                       |
| abort, revert, unrevert, share, unshare, summarize, command, shell | POST variants              | bridged                       |
| message CRUD (non-stream JSON), part patch/delete                  | `/session/.../message...`  | bridged                       |
| **prompt** (stream)                                                | `POST .../message`         | **special** (`HttpApiPrompt`) |
| **prompt_async**                                                   | `POST .../prompt_async`    | **special**                   |
| v2 entries / state / events                                        | `GET .../v2/*`             | bridged                       |
| instructions, context, contextToggle                               | GET/PATCH                  | **Hono only**                 |
| diff, messages, message (alt), monitor*, background*               | various                    | **Hono only**                 |
| permissions reply (per-session)                                    | `POST .../permissions/...` | bridged (regex)               |

## Missing from bridge (Hono-only today)

High-traffic / plan-relevant:

| Group                                    | Mount                            | Why                                                                 |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| ~~**Loop**~~                             | `/loop`                          | **Bridged** via `httpapi/loop.ts` (2026-06-18)                      |
| **Mission**                              | `/mission`                       | Same pattern as loop                                                |
| **PTY**                                  | `/pty`                           | WebSocket `pty.connect` — classify **special** (Phase 1.6 http-api) |
| **Analytics**                            | `/analytics`                     | Desktop dashboards                                                  |
| **Global**                               | `/global`                        | Health, dispose, **second** event entry (`global.event`)            |
| **Connectors, chatbot, companion, user** | respective mounts                | Integrations                                                        |
| **Mobile**                               | `/mobile`                        | Separate OpenAPI surface; intentionally not in instance bridge      |
| **VCS writes**                           | `/vcs` on `server.ts`            | `vcs.status`, `vcs.diff.raw`, `vcs.apply`                           |
| **App**                                  | `/app/*` on `server.ts`          | agents, skills, log                                                 |
| **Managed worktree**                     | `/experimental/managed-worktree` | Not in current regex set                                            |
| **Sync start**                           | (planned)                        | Blocked on `Sync.Service` Effect — **F1.3**                         |

## Classification summary (F0.4)

| Class        | Meaning                                                    | Examples                                                                  |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| **bridged**  | `supports()` true → Effect HttpApi or prompt special       | session CRUD, tui, v2 GET, file, mcp                                      |
| **special**  | Custom `handle()` branch; may still need `supports()` true | `/event`, session prompt POST                                             |
| **missing**  | Always Hono with flag on                                   | `/mission`, `/pty`, `/analytics`, session instructions/context/background |
| **deferred** | ADR / non-JSON                                             | PTY WebSocket, full SSE parity tests                                      |

## Maintenance

- After adding regex entries: extend `test/server/httpapi-bridge.test.ts` `supports` cases.
- Regenerate inventory: `bun run script/httpapi-bridge-inventory.ts` (prints critical `supports` matrix).
- Full OpenAPI op list: `rg 'operationId:' src/server --glob '*.ts'`.

## Related

- `specs/integration-plan-verified.md` — F1.1–1.6
- `specs/effect/http-api.md` — migration + deletion checklists
