# HttpApi bridge inventory (Hono vs `implementedRoutes`)

Audit date: 2026-07-07. Source of truth for bridged paths: `src/server/httpapi/bridge.ts` (`implementedRoutes` + `handle()` specials).

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

| Prefix / group                                                                                             | HttpApi module                       | Notes                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `/agent`, `/command`, `/skill`, `/lsp`, `/formatter`, `/path`, `/vcs`                                      | top-level / mixed                    | incl. `vcs.status`, `vcs.diff.raw` (text/x-diff), `vcs.apply` (bridged 2026-07-08)                     |
| `/config`, `/profiles`                                                                                     | `httpapi/config`, profiles in public | MCP config patch routes bridged                                                                        |
| `/doctor`                                                                                                  | `httpapi/doctor`                     | Diagnostic report bridged via `GET /doctor`                                                            |
| `/project`                                                                                                 | `httpapi/project`                    |                                                                                                        |
| `/provider`                                                                                                | `httpapi/provider`                   | OAuth authorize/callback bridged                                                                       |
| `/permission`, `/question`                                                                                 | `httpapi/*`                          |                                                                                                        |
| `/session` (subset)                                                                                        | `httpapi/session`                    | See **Session gaps** below                                                                             |
| `/mcp`                                                                                                     | `httpapi/mcp`                        | OAuth MCP auth routes bridged                                                                          |
| `/find`, `/file`                                                                                           | `httpapi/file`                       |                                                                                                        |
| `/brain`                                                                                                   | `httpapi/brain`                      | `GET /brain`, `POST /brain/trigger` (Wave 3a)                                                          |
| `/connectors`                                                                                              | `httpapi/connectors`                 | `GET /connectors`, `POST/DELETE /connectors/:name/auth`, `POST /connectors/invalidate` (Wave 3a)       |
| `/chatbot/*`                                                                                               | `httpapi/chatbot` (special)          | webhook receivers (`/chatbot/:platform/:name`) bypass the schema-encoded router (Wave 3a)              |
| `/user/*`                                                                                                  | `httpapi/users` (special/global)     | `register/login/logout/me/status/list/PATCH/DELETE` via `handleGlobal` instance-less branch (Wave 3a)  |
| `/experimental/tool`, `/experimental/worktree`, `/experimental/managed-worktree`, `/experimental/resource` | `httpapi/experimental`               | managed-worktree: create/remove/link/children/ancestors/list (Wave 3a)                                 |
| `/log`, `POST /skill`, `DELETE /skill/:name`                                                               | `httpapi/app`                        | `app.log`, `app.skill.create`, `app.skill.delete` (Wave 3b)                                            |
| `/experimental/workspace/*`                                                                                | `httpapi/workspace`                  | incl. `sync-list`, `warp`, restore                                                                     |
| `/instance/dispose`                                                                                        | top-level                            |                                                                                                        |
| `/tui/*` (listed paths)                                                                                    | `httpapi/tui`                        | Same queues as Hono `routes/tui.ts`                                                                    |
| `/loop`                                                                                                    | `httpapi/loop`                       | CRUD, run/abort/pause/resume, generate, templates, runs                                                |
| `/mission`                                                                                                 | `httpapi/mission`                    | Full group: CRUD, start/pause/cancel, feature mutate, generate, execs                                  |
| `/analytics`                                                                                               | `httpapi/analytics`                  | global, daily, session, sessions, leaderboard (all reads)                                              |
| `/global/*`                                                                                                | `httpapi/global` + `httpapi/event`   | **Separate instance-less branch**: `supportsGlobal`/`handleGlobal`, mounted before instance middleware |

Count: **145** regex entries in `implementedRoutes` plus **3** in `globalRoutes` (see `bridge.ts`), including the full `/loop` and `/mission` groups, `/analytics`, the three `/vcs` sub-routes, `GET /doctor`, and the instance-less `/global` branch.

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

| Group                    | Mount                                        | Why                                                                                                                               |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ~~**Loop**~~             | `/loop`                                      | **Bridged** via `httpapi/loop.ts` (2026-06-18)                                                                                    |
| ~~**Mission**~~          | `/mission`                                   | **Bridged** via `httpapi/mission.ts` (2026-07-08)                                                                                 |
| ~~**Analytics**~~        | `/analytics`                                 | **Bridged** via `httpapi/analytics.ts` (2026-07-08)                                                                               |
| ~~**Global**~~           | `/global`                                    | **Bridged** via `httpapi/global.ts` + instance-less `handleGlobal` branch (2026-07-08)                                            |
| ~~**Brain**~~            | `/brain`                                     | **Bridged** via `httpapi/brain.ts` (Wave 3a, 2026-07-08)                                                                          |
| ~~**Connectors**~~       | `/connectors`                                | **Bridged** via `httpapi/connectors.ts` (Wave 3a, 2026-07-08)                                                                     |
| ~~**Chatbot**~~          | `/chatbot/:platform/:name`                   | **Bridged** via `httpapi/chatbot.ts` special (Wave 3a)                                                                            |
| ~~**Users**~~            | `/user/*`                                    | **Bridged** via `httpapi/users.ts` + instance-less special (Wave 3a)                                                              |
| ~~**Managed worktree**~~ | `/experimental/managed-worktree`             | **Bridged** via `httpapi/experimental.ts` `managedWorktree*` group (Wave 3a)                                                      |
| **PTY**                  | `/pty`                                       | WebSocket `pty.connect` — classify **special** (Phase 1.6 http-api). CRUD now, WS design deferred (Wave 4).                       |
| **Companion**            | `/companion/*`                               | HTML/control surface served as raw HTML (`CompanionRoutes`); not in OpenAPI surface. Wave 4 design.                               |
| **Mobile**               | `/mobile`                                    | Separate OpenAPI surface; intentionally not in instance bridge                                                                    |
| **VCS writes**           | `/vcs` on `server.ts`                        | `vcs.status`, `vcs.diff.raw`, `vcs.apply`                                                                                         |
| ~~**App writes**~~       | `/log`, `POST /skill`, `DELETE /skill/:name` | **Bridged** via `httpapi/app.ts` (Wave 3b). Read-only `/agent`, `GET /skill`, `/lsp`, `/formatter` live on `httpapi/top-level.ts` |
| **Sync start**           | (planned)                                    | Blocked on `Sync.Service` Effect — **F1.3** (Wave 4 design work)                                                                  |

## Classification summary (F0.4)

| Class        | Meaning                                                    | Examples                                                                                     |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **bridged**  | `supports()` true → Effect HttpApi or prompt special       | session CRUD, tui, v2 GET, file, mcp                                                         |
| **special**  | Custom `handle()` branch; may still need `supports()` true | `/event`, session prompt POST                                                                |
| **missing**  | Always Hono with flag on                                   | `/pty`, session instructions/context/background, connectors/chatbot/companion/user, `/app/*` |
| **deferred** | ADR / non-JSON                                             | PTY WebSocket, full SSE parity tests                                                         |

## Maintenance

- After adding regex entries: extend `test/server/httpapi-bridge.test.ts` `supports` cases.
- Regenerate inventory: `bun run script/httpapi-bridge-inventory.ts` (prints critical `supports` matrix).
- Full OpenAPI op list: `rg 'operationId:' src/server --glob '*.ts'`.

## Related

- `specs/integration-plan-verified.md` — F1.1–1.6
- `specs/effect/http-api.md` — migration + deletion checklists
