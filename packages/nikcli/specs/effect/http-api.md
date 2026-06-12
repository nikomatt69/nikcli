# HttpApi migration

Plan for replacing instance Hono route implementations with Effect `HttpApi` while preserving behavior, OpenAPI, and SDK output during the transition.

## End State

- JSON route contracts and handlers live in `src/server/routes/instance/httpapi/*`.
- Route modules own their `HttpApiGroup`, schemas, handlers, and route-level middleware.
- `httpapi/server.ts` only composes groups, instance lookup, observability, and the web handler bridge.
- Hono route implementations are deleted once their `HttpApi` replacements are default, tested, and represented in the SDK/OpenAPI pipeline.
- Streaming, SSE, and websocket routes move later through Effect HTTP primitives or another explicit replacement plan; they do not need to fit `HttpApi` if `HttpApi` is the wrong abstraction.

## Current State

Current branch audit, 2026-05-06:

- `src/server/routes/instance/*` does not exist on this branch.
- `src/server/httpapi/question.ts` contains a real Effect `HttpApi` route slice for question list/reply/reject, covered by `bun test test/server/httpapi-question.test.ts`.
- `src/server/httpapi/permission.ts` contains a real Effect `HttpApi` route slice for permission list/reply, covered by `bun test test/server/httpapi-permission.test.ts`.
- `src/server/httpapi/top-level.ts` contains a real Effect `HttpApi` route slice for `POST /instance/dispose` and top-level reads: `GET /path`, `GET /vcs`, `GET /command`, `GET /agent`, `GET /skill`, `GET /lsp`, and `GET /formatter`.
- `src/server/httpapi/config.ts` contains a real Effect `HttpApi` route slice for `GET /config`, `PATCH /config`, and `GET /config/providers`.
- `src/server/httpapi/experimental.ts` contains a real Effect `HttpApi` route slice for experimental JSON routes: `GET /experimental/tool/ids`, `GET /experimental/tool`, `POST /experimental/worktree`, `GET /experimental/worktree`, `DELETE /experimental/worktree`, `POST /experimental/worktree/reset`, and `GET /experimental/resource`.
- `src/server/httpapi/file.ts` contains a real Effect `HttpApi` route slice for `GET /find`, `GET /find/file`, `GET /find/symbol`, `GET /file`, `GET /file/content`, `PUT /file/content`, and `GET /file/status`.
- `src/server/httpapi/mcp.ts` contains a real Effect `HttpApi` route slice for non-OAuth MCP management: `GET /mcp`, `POST /mcp`, `DELETE /mcp/:name/auth`, `POST /mcp/:name/connect`, `POST /mcp/:name/disconnect`, and `POST /mcp/:name/toggle`.
- `src/server/httpapi/project.ts` contains a real Effect `HttpApi` route slice for `GET /project`, `GET /project/current`, and `PATCH /project/:projectID`.
- `src/server/httpapi/provider.ts` contains a real Effect `HttpApi` route slice for `GET /provider`, `GET /provider/auth`, `POST /provider/:providerID/api`, and `DELETE /provider/:providerID/auth`.
- `src/server/httpapi/session.ts` contains a real Effect `HttpApi` route slice for session create/update/delete/fork/abort/revert/unrevert, read-only session routes, and non-streaming message/part JSON routes: `POST /session`, `DELETE /session/:sessionID`, `PATCH /session/:sessionID`, `POST /session/:sessionID/fork`, `POST /session/:sessionID/abort`, `POST /session/:sessionID/revert`, `POST /session/:sessionID/unrevert`, `GET /session`, `GET /session/status`, `GET /session/:sessionID`, `GET /session/:sessionID/children`, `GET /session/:sessionID/todo`, `GET /session/:sessionID/diff`, `GET /session/:sessionID/message`, `GET /session/:sessionID/message/:messageID`, `DELETE /session/:sessionID/message/:messageID`, `DELETE /session/:sessionID/message/:messageID/part/:partID`, and `PATCH /session/:sessionID/message/:messageID/part/:partID`.
- `src/server/httpapi/workspace.ts` contains a real Effect `HttpApi` route slice for workspace routes: `GET /experimental/workspace/adaptor`, `GET /experimental/workspace`, `POST /experimental/workspace/:id`, `DELETE /experimental/workspace/:id`, `POST /experimental/workspace/:id/restore`, and `POST /experimental/workspace/:id/session/:sessionID/restore`.
- `src/server/httpapi/public.ts` composes the implemented slices into one `PublicHttpApi`, covered by `bun test test/server/httpapi-public.test.ts`.
- `src/server/httpapi/bridge.ts` mounts the implemented top-level, config, experimental, file, MCP, project, provider, question, permission, session, and workspace slices through `HttpApiBuilder.toWebHandler` when `NIKCLI_EXPERIMENTAL_HTTPAPI=1`, and passes the active instance into the Effect context. The bridge matches exact method/path patterns so unported routes fall through to legacy Hono even while the flag is enabled. Coverage: `bun test test/server/httpapi-session.test.ts test/server/httpapi-workspace.test.ts test/server/httpapi-experimental.test.ts test/server/httpapi-mcp.test.ts test/server/httpapi-file.test.ts test/server/httpapi-provider.test.ts test/server/httpapi-config.test.ts test/server/httpapi-project.test.ts test/server/httpapi-top-level.test.ts test/server/httpapi-bridge.test.ts`.
- The active server route files are still `src/server/routes/*.ts` and import Hono / `hono-openapi`.
- The current mount is an in-Hono experimental bridge after the existing instance/workspace middleware. The full backend-fork-at-startup path is still open.
- The route checklist below remains unchecked until the corresponding Effect `HttpApi` route is mounted through the experimental backend/bridge and covered by tests or SDK/OpenAPI verification.

Historical target state to reintroduce intentionally:

- `NIKCLI_EXPERIMENTAL_HTTPAPI` selects the backend at server startup. Default is still `hono`.
- `server/backend.ts` picks one of `effect-httpapi` or `hono`; `server.ts` builds either a pure Effect `HttpApi` web handler or the legacy Hono app accordingly. The earlier in-Hono "bridge" model has been replaced by this fork-at-startup.
- Legacy Hono routes remain mounted for the `hono` backend and remain the source for `hono-openapi` SDK generation.
- An Effect `HttpApi` OpenAPI surface exists (`OpenApi.fromApi(PublicApi)` in `cli/cmd/generate.ts --httpapi`, `NIKCLI_SDK_OPENAPI=httpapi` in `packages/sdk/js/script/build.ts`) but is opt-in. The default SDK generation is still Hono.
- `httpapi/public.ts` carries the Hono-compat normalization for the Effect-generated OpenAPI surface (auth scheme strip, request-body required flag, optional `null` arms, `BadRequestError` / `NotFoundError` remap, `$ref` self-cycle fix, `auth_token` query injection). Today's Effect-generated SDK is not byte-identical to the Hono-generated SDK — see Phase 4.
- Auth is centrally configured for the Effect backend via Effect `Config` rather than re-attached in each route module.
- Auth supports Basic auth and the legacy `auth_token` query parameter through `HttpApiSecurity.apiKey`.
- Instance context is provided by `httpapi/server.ts` using `directory`, `workspace`, and `x-nikcli-directory`.
- `Observability.layer` is provided in the Effect route layer and deduplicated through the shared `memoMap`.
- CORS middleware is wired into both backends.

## Migration Rules

- Preserve runtime behavior first. Semantic changes, new error behavior, or route shape changes need separate PRs.
- Migrate one route group, or one coherent subset of a route group, at a time.
- Reuse existing services. Do not re-architect service logic during HTTP boundary migration.
- Effect Schema owns route DTOs. Keep `.zod` only as compatibility for remaining Hono/OpenAPI surfaces.
- Regenerate the SDK after schema or OpenAPI-affecting changes and verify the diff is expected.
- Do not delete a Hono route until the SDK/OpenAPI pipeline no longer depends on its Hono `describeRoute` entry.

## Route Slice Checklist

Use this checklist for each small HttpApi migration PR:

1. Read the legacy Hono route and copy behavior exactly, including default values, headers, operation IDs, response schemas, and status codes.
2. Put the new `HttpApiGroup`, route paths, DTO schemas, and handlers in `src/server/routes/instance/httpapi/*`.
3. Mount the new paths in `src/server/routes/instance/index.ts` only inside the `NIKCLI_EXPERIMENTAL_HTTPAPI` block.
4. Use `InstanceState.context` / `InstanceState.directory` inside HttpApi handlers instead of `Instance.directory`, `Instance.worktree`, or `Instance.project` ALS globals.
5. Reuse existing services directly. If a service returns plain objects, use `Schema.Struct`; use `Schema.Class` only when handlers return actual class instances.
6. Keep legacy Hono routes and `.zod` compatibility in place for SDK/OpenAPI generation.
7. Add tests that hit the Hono-mounted bridge via `InstanceRoutes`, not only the raw `HttpApi` web handler, when the route depends on auth or instance context.
8. Run `bun typecheck` from `packages/nikcli`, relevant `bun run test:ci ...` tests from `packages/nikcli`, and `./packages/sdk/js/script/build.ts` from the repo root.

## Hono Deletion Checklist

Use this checklist before deleting any Hono route implementation. A route being `bridged` is not enough.

1. `HttpApi` parity is complete for the route path, method, auth behavior, query parameters, request body, response status, response headers, and error status.
2. The route is mounted by default, not only behind `NIKCLI_EXPERIMENTAL_HTTPAPI`.
3. If a fallback flag exists, tests cover both the default `HttpApi` path and the fallback Hono path until the fallback is removed.
4. OpenAPI generation uses the Effect `HttpApi` route as the source for that path.
5. Generated SDK output is unchanged from the Hono-generated contract, or the SDK diff is intentionally reviewed and accepted.
6. The legacy Hono `describeRoute`, validator, and handler for that path are removed.
7. Any duplicate Zod-only DTOs are deleted or kept only as `.zod` compatibility on the canonical Effect Schema.
8. Bridge tests exist for auth, instance selection, success response, and route-specific side effects.
9. Mutation routes prove persisted side effects and cleanup behavior in tests. If the mutation disposes/reloads the active instance, disposal happens through an explicit post-response lifecycle hook rather than inline handler teardown.
10. Streaming, SSE, websocket, and UI bridge routes have a specific non-Hono replacement plan. Do not force them through `HttpApi` if raw Effect HTTP is a better fit.

Hono can be removed from the instance server only after all mounted Hono route groups meet this checklist and `server/routes/instance/index.ts` no longer depends on Hono routing for default behavior.

## Experimental Read Slice Guidance

For the experimental route group, port read-only JSON routes before mutations:

- Good first batch: `GET /console`, `GET /console/orgs`, `GET /tool/ids`, `GET /resource`.
- Consider `GET /worktree` only if the handler uses `InstanceState.context` instead of `Instance.project`.
- Defer `POST /console/switch`, worktree create/remove/reset, and `GET /session` to separate PRs because they mutate state or have broader pagination/session behavior.
- Preserve response headers such as pagination cursors if a route is ported.
- If SDK generation changes, explain whether it is a semantic contract change or a generator-equivalent type normalization.

## Schema Notes

- Use `Schema.Struct(...).annotate({ identifier })` for named OpenAPI refs when handlers return plain objects.
- Use `Schema.Class` only when the handler returns real class instances or the constructor requirement is intentional.
- Keep nested anonymous shapes as `Schema.Struct` unless a named SDK type is useful.
- Avoid parallel hand-written Zod and Effect definitions for the same route boundary.

## Phases

### 1. Stabilize The Bridge

Before porting more routes, cover the bridge behavior that every route depends on.

- Add tests that hit the Hono-mounted `HttpApi` bridge, not just `HttpApiBuilder.layer` directly.
- Cover auth disabled, Basic auth success, `auth_token` success, missing credentials, and bad credentials.
- Cover `directory` and `x-nikcli-directory` instance selection.
- Verify generated SDK output remains unchanged for non-SDK work.
- Fix or remove any implemented-but-unmounted `HttpApi` groups.

### 2. Complete The Inventory

Create a route inventory from the actual Hono registrations and classify each route.

Statuses:

- `bridged`: served through the `HttpApi` bridge when the flag is on.
- `implemented`: `HttpApi` group exists but is not mounted through Hono.
- `next`: good JSON candidate for near-term porting.
- `later`: portable, but needs schema/service cleanup first.
- `special`: SSE, websocket, streaming, or UI bridge behavior that likely needs raw Effect HTTP rather than `HttpApi`.

### 3. Finish JSON Route Parity

Port remaining JSON routes in small batches.

Good near-term candidates:

- top-level reads: `GET /path`, `GET /vcs`, `GET /vcs/diff`, `GET /command`, `GET /agent`, `GET /skill`, `GET /lsp`, `GET /formatter`
- simple mutations: `POST /instance/dispose`
- experimental JSON reads: console, tool, worktree list, resource list
- deferred JSON mutations: workspace/worktree create/remove/reset, file search, MCP auth flows

Keep large or stateful groups for later:

- `session`
- `sync`
- process-level experimental routes

### 4. Move OpenAPI And SDK Generation

Hono routes cannot be deleted while `hono-openapi` is the source of SDK generation.

Status on this branch: the Effect `HttpApi` OpenAPI surface is not present in current code. Rebuild it as opt-in first, then make SDK generation compare Hono vs Effect before flipping the default. Historical diff risks to preserve when that path is restored:

- Branded-type `pattern` constraints on ID schemas are not propagated to the Effect output (~169 missing).
- Per-property `description` annotations are not propagated through `Schema.Struct` to the Effect output (~107 missing).
- `Event.*` and `SyncEvent.*` component names use dotted form in Hono and PascalCase in Effect (~50 differences, breaks SDK type names).
- Effect's component deduper emits numbered duplicates (`Session9`, `SyncEvent.session.updated.11`) that need a name-collision fix.
- Cosmetic-only diffs (`additionalProperties: false`, `const` vs `enum`, MAX_SAFE_INTEGER `maximum`, `propertyNames`) can be normalized in `public.ts` if they would otherwise change SDK output.

Required before route deletion:

- Close the diff above so Effect-generated SDK output matches the Hono-generated SDK output for every retained path.
- Keep operation IDs, schemas, status codes, and SDK type names stable unless the change is intentional.
- Flip `packages/sdk/js/script/build.ts` default to `httpapi` and regenerate.
- Compare generated SDK output against `dev` for every route group deletion.
- Remove Hono OpenAPI stubs only after Effect OpenAPI is the SDK source for those paths.

V2 cleanup once SDK compatibility no longer needs the legacy Hono contract:

- Remove `public.ts` compatibility transforms that hide honest `HttpApi` metadata, including auth `securitySchemes`, per-route `security`, and generated `401` responses.
- Stop remapping built-in `HttpApi` error schemas back to legacy Hono `BadRequestError` / `NotFoundError` components if V2 clients can consume the actual Effect error shape.
- Prefer the direct `HttpApi` OpenAPI output for request/response bodies and named component schemas instead of rewriting it to match Hono generator quirks.
- Keep schema fixes that describe the actual wire format, but delete transforms that only preserve legacy SDK type names or inline-vs-ref shape.
- Re-evaluate `auth_token` as an OpenAPI security scheme rather than a hand-injected query parameter once clients can consume the V2 spec.

### 5. Make HttpApi Default For JSON Routes

After JSON parity and SDK generation are covered:

- Flip the bridge default for ported JSON routes.
- Keep a short-lived fallback flag for the old Hono implementation.
- Run the same tests against both the default and fallback path during rollout.
- Stop adding new Hono handlers for JSON routes once the default flips.

### 6. Delete Hono Route Implementations

Delete Hono routes group-by-group after each group meets the deletion criteria.

Deletion criteria:

- `HttpApi` route is mounted by default.
- Behavior is covered by bridge-level tests.
- OpenAPI/SDK generation comes from Effect for that path.
- SDK diff is zero or explicitly accepted.
- Legacy Hono route is no longer needed as a fallback.

After deleting a group:

- Remove its Hono route file or dead endpoints.
- Remove its `.route(...)` registration from `instance/index.ts`.
- Remove duplicate Zod-only route DTOs if Effect Schema now owns the type.
- Regenerate SDK and verify output.

### 7. Replace Special Routes

Special routes need explicit designs before Hono can disappear completely.

- `event`: SSE
- `pty`: websocket
- `tui`: UI/control bridge behavior
- streaming `session` endpoints

Use raw Effect HTTP routes where `HttpApi` does not fit. The goal is deleting Hono implementations, not forcing every transport shape through `HttpApi`.

## Current Route Status

| Area                      | Status            | Notes                                                                                                                                                                                                                   |
| ------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `question`                | `bridged`         | `src/server/httpapi/question.ts` implements list/reply/reject; covered directly and through `test/server/httpapi-bridge.test.ts`                                                                                        |
| `permission`              | `bridged`         | `src/server/httpapi/permission.ts` implements list/reply; covered directly and through `test/server/httpapi-bridge.test.ts`                                                                                             |
| `provider`                | `bridged` partial | `GET /provider`, `GET /provider/auth`, `POST /provider/:providerID/api`, and `DELETE /provider/:providerID/auth` are bridged; OAuth routes remain open                                                                  |
| `config`                  | `bridged`         | `GET /config`, `PATCH /config`, and `GET /config/providers` are bridged; Hono deletion remains open                                                                                                                     |
| `project`                 | `bridged` partial | `GET /project`, `GET /project/current`, and `PATCH /project/:projectID` are bridged; checklist item `POST /project/git/init` is not registered on this branch                                                           |
| `file`                    | `bridged`         | read/search routes and `PUT /file/content` are bridged; Hono deletion remains open                                                                                                                                      |
| `mcp`                     | `bridged`         | all management + OAuth routes bridged: status, add, startAuth, authCallback, authenticate, removeAuth, connect, disconnect, toggle                                                                                      |
| `workspace`               | `bridged` partial | adaptor/list plus create/remove/restore/session-restore routes are bridged; `GET /experimental/workspace/status` is still unchecked because no matching Hono registration was found                                     |
| top-level instance routes | `bridged` partial | `POST /instance/dispose`, `GET /path`, `GET /vcs`, `GET /command`, `GET /agent`, `GET /skill`, `GET /lsp`, and `GET /formatter` are bridged; `GET /vcs/diff` is not registered on this branch                           |
| experimental JSON routes  | `bridged` partial | `tool/ids`, `tool`, `worktree` create/list/remove/reset, and `resource` routes are bridged; console routes and global session list remain open                                                                          |
| `session`                 | `bridged` partial | create/update/delete/fork/abort/revert/unrevert/list/status/get/children/todo/diff/messages plus single-message and part JSON routes are bridged; prompt, share, init, summarize, shell, and command routes remain Hono |
| `sync`                    | `not ported`      | no current Effect `HttpApi` sync route exists                                                                                                                                                                           |
| `event`                   | `not ported`      | current implementation uses Hono SSE                                                                                                                                                                                    |
| `pty`                     | `special`         | current implementation uses Hono websocket                                                                                                                                                                              |
| `tui`                     | `special`         | current implementation is a Hono UI bridge                                                                                                                                                                              |

## Full Route Checklist

This checklist tracks bridge parity only. Checked routes are available through the experimental `HttpApi` bridge; Hono deletion is tracked separately by the deletion checklist above.

### Top-Level Instance Routes

- [x] `POST /instance/dispose` - dispose active instance. Current branch behavior disposes inline before returning JSON; post-response lifecycle remains a Hono deletion criterion.
- [x] `GET /path` - current directory and worktree paths.
- [x] `GET /vcs` - current VCS status.
- [ ] `GET /vcs/diff` - VCS diff summary. Current branch audit: no matching Hono registration found in `src/server/server.ts`; keep unchecked until removed from inventory or reintroduced intentionally.
- [x] `GET /command` - command catalog.
- [x] `GET /agent` - agent catalog.
- [x] `GET /skill` - skill catalog.
- [x] `GET /lsp` - LSP status.
- [x] `GET /formatter` - formatter status.

### Config Routes

- [x] `GET /config` - read config.
- [x] `PATCH /config` - update config and dispose active instance. Current branch behavior disposes inline before returning JSON; post-response lifecycle remains a Hono deletion criterion.
- [x] `GET /config/providers` - config provider summary.

### Project Routes

- [x] `GET /project` - list projects.
- [x] `GET /project/current` - current project.
- [ ] `POST /project/git/init` - initialize git and reload active instance after response. Current branch audit: no matching Hono registration found in `src/server/routes/project.ts`; keep unchecked until removed from inventory or reintroduced intentionally.
- [x] `PATCH /project/:projectID` - update project metadata.

### Provider Routes

- [x] `GET /provider` - list providers.
- [x] `GET /provider/auth` - list provider auth methods.
- [x] `POST /provider/:providerID/api` - store provider API key and dispose active instance.
- [x] `DELETE /provider/:providerID/auth` - remove provider credentials and dispose active instance.
- [x] `POST /provider/:providerID/oauth/authorize` - start provider OAuth. Evidence: `src/server/httpapi/provider.ts` `oauthAuthorize`, mounted in `bridge.ts`, covered in `test/server/httpapi-provider.test.ts`.
- [x] `POST /provider/:providerID/oauth/callback` - finish provider OAuth. Evidence: `src/server/httpapi/provider.ts` `oauthCallback` (refreshes the provider cache without disposing, like the Hono route).

### Question Routes

- [x] `GET /question` - list questions.
- [x] `POST /question/:requestID/reply` - reply to question.
- [x] `POST /question/:requestID/reject` - reject question.

### Permission Routes

- [x] `GET /permission` - list permission requests.
- [x] `POST /permission/:requestID/reply` - reply to permission request.

### File Routes

- [x] `GET /find` - text search.
- [x] `GET /find/file` - file search.
- [x] `GET /find/symbol` - symbol search.
- [x] `GET /file` - list directory entries.
- [x] `GET /file/content` - read file content.
- [x] `GET /file/status` - file status.
- [x] `PUT /file/content` - write file content. Evidence: `src/server/httpapi/file.ts` and `bun test test/server/httpapi-file.test.ts`.

### MCP Routes

- [x] `GET /mcp` - MCP status.
- [x] `POST /mcp` - add MCP server at runtime.
- [x] `POST /mcp/:name/auth` - start MCP OAuth. Evidence: `src/server/httpapi/mcp.ts` `startAuth` endpoint, mounted in `bridge.ts`.
- [x] `POST /mcp/:name/auth/callback` - finish MCP OAuth callback. Evidence: `src/server/httpapi/mcp.ts` `authCallback` endpoint, mounted in `bridge.ts`.
- [x] `POST /mcp/:name/auth/authenticate` - run MCP OAuth authenticate flow. Evidence: `src/server/httpapi/mcp.ts` `authenticate` endpoint, mounted in `bridge.ts`.
- [x] `DELETE /mcp/:name/auth` - remove MCP OAuth credentials.
- [x] `POST /mcp/:name/connect` - connect MCP server.
- [x] `POST /mcp/:name/disconnect` - disconnect MCP server.
- [x] `POST /mcp/:name/toggle` - enable or disable MCP server config.

### Experimental Routes

- [x] `GET /experimental/console` - resolved: no matching Hono registration on this branch. Evidence: `rg -n "experimental/console" src/server` returns no matches. Remove from inventory or reintroduce intentionally.
- [x] `GET /experimental/console/orgs` - resolved: no matching Hono registration on this branch.
- [x] `POST /experimental/console/switch` - resolved: no matching Hono registration on this branch.
- [x] `GET /experimental/tool/ids` - tool IDs.
- [x] `GET /experimental/tool` - tools for provider/model.
- [x] `GET /experimental/worktree` - list worktrees.
- [x] `POST /experimental/worktree` - create worktree. Evidence: `src/server/httpapi/experimental.ts` and `bun test test/server/httpapi-experimental.test.ts`.
- [x] `DELETE /experimental/worktree` - remove worktree. Evidence: `src/server/httpapi/experimental.ts`, `src/worktree/index.ts`, and `bun test test/server/httpapi-experimental.test.ts`.
- [x] `POST /experimental/worktree/reset` - reset worktree. Evidence: `src/server/httpapi/experimental.ts` and `bun test test/server/httpapi-experimental.test.ts`.
- [x] `GET /experimental/session` - resolved: no matching Hono registration on this branch. Evidence: `rg -n "experimental/session" src/server` returns no matches.
- [x] `GET /experimental/resource` - MCP resources.

### Workspace Routes

- [x] `GET /experimental/workspace/adaptor` - list workspace adaptors. Current branch route spelling is `adaptor`, matching `src/server/routes/workspace.ts`.
- [x] `POST /experimental/workspace/:id` - create workspace. Current branch route includes a required workspace id path parameter. Evidence: `src/server/httpapi/workspace.ts` and `bun test test/server/httpapi-workspace.test.ts`.
- [x] `GET /experimental/workspace` - list workspaces.
- [x] `GET /experimental/workspace/status` - resolved: no matching Hono registration on this branch. Evidence: `rg -n "workspace/status" src/server` returns no matches.
- [x] `DELETE /experimental/workspace/:id` - remove workspace. Evidence: `src/server/httpapi/workspace.ts`, `src/worktree/index.ts`, and `bun test test/server/httpapi-workspace.test.ts`.
- [x] `POST /experimental/workspace/:id/restore` - restore workspace state. Evidence: `src/server/httpapi/workspace.ts` and `bun test test/server/httpapi-workspace.test.ts`.
- [x] `POST /experimental/workspace/:id/session/:sessionID/restore` - restore session into workspace. Evidence: `src/server/httpapi/workspace.ts` and `bun test test/server/httpapi-workspace.test.ts`.

### Sync Routes

- [ ] `POST /sync/start` - start workspace sync. Blocked by Phase I (`Sync.Service` does not exist as Effect service yet on this branch).
- [ ] `POST /sync/replay` - replay sync events. Blocked by Phase I.
- [ ] `POST /sync/history` - list sync event history. Blocked by Phase I.

### Session Routes

- [x] `GET /session` - list sessions. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `GET /session/status` - session status map. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `GET /session/:sessionID` - get session. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `GET /session/:sessionID/children` - get child sessions. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `GET /session/:sessionID/todo` - get session todos. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `GET /session/:sessionID/diff` - session diff. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `GET /session/:sessionID/message` - list session messages. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session` - create session. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `DELETE /session/:sessionID` - delete session. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `PATCH /session/:sessionID` - update session metadata. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session/:sessionID/init` - resolved: the dedicated route was removed by design on 2026-06-10 (`specs/v2/session.md`); the `/init` command flow is the only path.
- [x] `POST /session/:sessionID/fork` - fork session. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session/:sessionID/abort` - abort session. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session/:sessionID/share` - share session. Evidence: `src/server/httpapi/session.ts` `share` (mirrors the Hono origin handling), mounted in `bridge.ts`.
- [x] `DELETE /session/:sessionID/share` - unshare session. Evidence: `src/server/httpapi/session.ts` `unshare`.
- [x] `POST /session/:sessionID/summarize` - summarize session. Evidence: `src/server/httpapi/session.ts` `summarize`, declared-404 covered in `test/server/httpapi-session.test.ts`.
- [x] `GET /session/:sessionID/message/:messageID` - get message. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `DELETE /session/:sessionID/message/:messageID` - delete message. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `DELETE /session/:sessionID/message/:messageID/part/:partID` - delete part. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `PATCH /session/:sessionID/message/:messageID/part/:partID` - update part. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [ ] `POST /session/:sessionID/message` - prompt with streaming response.
- [ ] `POST /session/:sessionID/prompt_async` - async prompt.
- [x] `POST /session/:sessionID/command` - run command. Evidence: `src/server/httpapi/session.ts` `command` (BusyError maps to the declared 409).
- [x] `POST /session/:sessionID/shell` - run shell command. Evidence: `src/server/httpapi/session.ts` `shell`.
- [x] `POST /session/:sessionID/revert` - revert message. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session/:sessionID/unrevert` - restore reverted messages. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session/:sessionID/permissions/:permissionID` - deprecated permission response route. Evidence: `src/server/httpapi/session.ts` `permissionRespond` (thin alias of permission.reply, kept for SDK compatibility).

### Event Routes

- [ ] `GET /event` - SSE event stream via raw Effect HTTP.

### PTY Routes

- [ ] `GET /pty` - list PTY sessions.
- [ ] `POST /pty` - create PTY session.
- [ ] `GET /pty/:ptyID` - get PTY session.
- [ ] `PUT /pty/:ptyID` - update PTY session.
- [ ] `DELETE /pty/:ptyID` - remove PTY session.
- [ ] `GET /pty/:ptyID/connect` - PTY websocket; replace with raw Effect HTTP/websocket support.

### TUI Routes

- [ ] `POST /tui/append-prompt` - append prompt.
- [ ] `POST /tui/open-help` - open help.
- [ ] `POST /tui/open-sessions` - open sessions.
- [ ] `POST /tui/open-themes` - open themes.
- [ ] `POST /tui/open-models` - open models.
- [ ] `POST /tui/submit-prompt` - submit prompt.
- [ ] `POST /tui/clear-prompt` - clear prompt.
- [ ] `POST /tui/execute-command` - execute command.
- [ ] `POST /tui/show-toast` - show toast.
- [ ] `POST /tui/publish` - publish TUI event.
- [ ] `POST /tui/select-session` - select session.
- [ ] `GET /tui/control/next` - get next TUI request.
- [ ] `POST /tui/control/response` - submit TUI control response.

## Remaining PR Plan

Prefer smaller PRs from here so route behavior and SDK/OpenAPI fallout stays reviewable.

1. [x] Bridge `PATCH /project/:projectID`. Evidence: `src/server/httpapi/project.ts` and `bun test test/server/httpapi-project.test.ts`.
2. [x] Bridge MCP add/connect/disconnect routes. Evidence: `src/server/httpapi/mcp.ts` and `bun test test/server/httpapi-mcp.test.ts`.
3. [x] Bridge MCP OAuth routes: start, callback, authenticate. Evidence: `src/server/httpapi/mcp.ts` with the declared `McpOAuthUnsupportedError` 400.
4. [x] Resolved: experimental console routes have no Hono registration on this branch — removed from scope.
5. [x] Bridge experimental tool/worktree/resource routes. Evidence: `src/server/httpapi/experimental.ts` and `bun test test/server/httpapi-experimental.test.ts`.
6. [x] Resolved: no global session list route exists on this branch (`routes/global.ts` has only health, /event SSE, and dispose) — removed from scope.
7. [x] Bridge read-only workspace adaptor/list routes. Evidence: `src/server/httpapi/workspace.ts` and `bun test test/server/httpapi-workspace.test.ts`.
8. [x] Bridge workspace create/remove/session-restore routes. Evidence: `src/server/httpapi/workspace.ts`, `src/worktree/index.ts`, and `bun test test/server/httpapi-workspace.test.ts`.
9. [ ] Bridge sync start/replay/history routes.
10. [x] Bridge session read routes: list, status, get, children, todo, diff, and messages are bridged. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
11. [x] Bridge session lifecycle mutation routes: create, delete, update, fork, and abort are bridged. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
12. [x] Bridge remaining session mutation routes: share/unshare/summarize/command/shell/deprecated-permissions are bridged (2026-06-12); init was removed by design. Only the streaming prompt routes (`POST /session/:id/message`, `POST /session/:id/prompt_async`) remain, tracked with the SSE work in step 13.
13. [ ] Replace event SSE with non-Hono Effect HTTP. The Effect backend has a raw Effect HTTP `httpapi/event.ts`; the Hono backend still uses `hono/streaming` `streamSSE`. Either port Hono `/event` to raw Effect HTTP for the fallback window, or skip and delete it together with Hono in step 15.
14. [ ] Replace pty websocket/control routes with non-Hono Effect HTTP for the Effect backend. Hono `pty.ts` remains in the Hono backend.
15. [ ] Replace tui bridge routes or explicitly isolate them behind a non-Hono compatibility layer for the Effect backend. Hono `tui.ts` remains in the Hono backend.
16. [ ] Switch OpenAPI/SDK generation to Effect routes and compare SDK output. Effect path is implemented and opt-in via `--httpapi` / `NIKCLI_SDK_OPENAPI=httpapi`. Close the schema-shape gaps in `public.ts` (branded `pattern`, per-property `description`, `Event.*` / `SyncEvent.*` naming, dedup collisions), then flip `packages/sdk/js/script/build.ts` default.
17. [ ] Flip `backend.ts` default from `hono` to `effect-httpapi`, keep `NIKCLI_EXPERIMENTAL_HTTPAPI` (or its inverse) as a short fallback flag, then delete replaced Hono route files.

## Checklist

- [x] Add first `HttpApi` JSON route slices. Evidence: `src/server/httpapi/question.ts` plus `bun test test/server/httpapi-question.test.ts`.
- [x] Bridge selected `HttpApi` routes behind `NIKCLI_EXPERIMENTAL_HTTPAPI`. Evidence: `src/server/httpapi/bridge.ts` and `bun test test/server/httpapi-bridge.test.ts`. This is an in-Hono experimental bridge; backend-fork-at-startup remains open.
- [x] Reuse existing Effect services in implemented handlers. Evidence: `QuestionHttpApi` yields `Question.Service`, `PermissionHttpApi` yields `PermissionNext.Service`, and `bun test test/server/httpapi-question.test.ts test/server/httpapi-permission.test.ts test/server/httpapi-public.test.ts` passes.
- [ ] Provide auth, instance lookup, and observability in the Effect route layer.
- [ ] Centralize auth via Effect `Config` for the Effect backend.
- [ ] Support `auth_token` as a query security scheme.
- [ ] Add bridge-level auth and instance tests.
- [ ] Complete exact Hono route inventory.
- [x] Resolve implemented-but-unmounted route groups. Evidence: `rg --files src/server/httpapi` lists only active route slices plus `public` and `bridge`; current slices `top-level`, `config`, `experimental`, `file`, `mcp`, `project`, `provider`, `question`, `permission`, and `workspace` are bridged.
- [x] Port current top-level JSON reads. Evidence: `src/server/httpapi/top-level.ts` and `bun test test/server/httpapi-top-level.test.ts`. `GET /vcs/diff` is not present in the current Hono route registration and remains an inventory cleanup item.
- [ ] Implement Effect `HttpApi` OpenAPI generation behind `--httpapi` / `NIKCLI_SDK_OPENAPI=httpapi`.
- [ ] Close Effect-vs-Hono OpenAPI schema-shape gaps and flip the SDK generator default.
- [ ] Flip the runtime backend default from `hono` to `effect-httpapi`, with a short fallback flag.
- [ ] Delete replaced Hono route implementations.
- [ ] Replace SSE/websocket/streaming Hono routes with non-Hono implementations (or remove with the rest of Hono).
