# HttpApi migration

Plan for replacing instance Hono route implementations with Effect `HttpApi` while preserving behavior, OpenAPI, and SDK output during the transition.

## End State

- JSON route contracts and handlers live in `src/server/httpapi/*`.
- Route modules own their `HttpApiGroup`, schemas, handlers, and route-level middleware.
- `httpapi/public.ts` composes groups, and `httpapi/bridge.ts` exposes the web handler while the Hono bridge exists. The future pure Effect backend should compose groups, instance lookup, observability, and the Bun server boundary in one place.
- Hono route implementations are deleted once their `HttpApi` replacements are default, tested, and represented in the SDK/OpenAPI pipeline.
- Streaming, SSE, and websocket routes move through Effect HTTP primitives (`HttpServerResponse.stream`, raw `HttpRouter`, or `handleRaw`) or another explicit replacement plan; they do not need to fit JSON `HttpApi` if `HttpApi` is the wrong abstraction.

## Current State

Current branch audit, 2026-07-07:

- `src/server/routes/instance/*` does not exist on this branch.
- `src/server/httpapi/question.ts` contains a real Effect `HttpApi` route slice for question list/reply/reject, covered by `bun test test/server/httpapi-question.test.ts`.
- `src/server/httpapi/permission.ts` contains a real Effect `HttpApi` route slice for permission list/reply, covered by `bun test test/server/httpapi-permission.test.ts`.
- `src/server/httpapi/top-level.ts` contains a real Effect `HttpApi` route slice for `POST /instance/dispose` and top-level reads: `GET /path`, `GET /vcs`, `GET /command`, `GET /agent`, `GET /skill`, `GET /lsp`, and `GET /formatter`.
- `src/server/httpapi/config.ts` contains a real Effect `HttpApi` route slice for `GET /config`, `PATCH /config`, and `GET /config/providers`.
- `src/server/httpapi/doctor.ts` contains a real Effect `HttpApi` route slice for `GET /doctor`, covered by `bun test test/server/httpapi-doctor.test.ts`.
- `src/server/httpapi/analytics.ts` contains a real Effect `HttpApi` route slice for `GET /analytics/global`, `GET /analytics/daily`, `GET /analytics/session/:sessionID`, `GET /analytics/sessions`, and `GET /analytics/leaderboard`, covered by `bun test test/server/httpapi-analytics.test.ts`.
- `src/server/httpapi/global.ts` contains a real Effect `HttpApi` route slice for the instance-less `GET /global/health` and `POST /global/dispose` (plus the shared `GlobalDisposedEvent` definition). `GET /global/event` is served as raw SSE by `HttpApiEvent.handle()`. Because `/global` is mounted before the instance/workspace middleware, `server.ts` forwards these paths through a dedicated `HttpApiBridge.supportsGlobal` / `handleGlobal` branch that provides no instance context. Covered by `bun test test/server/httpapi-global.test.ts`.
- `src/server/httpapi/mission.ts` contains a real Effect `HttpApi` route slice for the full mission group: list, templates, generate, get, upsert, update, delete, start, pause, cancel, feature mutate, execs, and recent execs. Create/update bodies are parsed with the same zod schemas as the legacy validator so zod defaults keep being applied. `generateFromDescription` moved to `src/mission/generate.ts` (neutral module, mirrors `loop/generate.ts`); the Hono route re-exports it. Covered by `bun test test/server/httpapi-mission.test.ts`.
- `src/server/httpapi/experimental.ts` contains a real Effect `HttpApi` route slice for experimental JSON routes: `GET /experimental/tool/ids`, `GET /experimental/tool`, `POST /experimental/worktree`, `GET /experimental/worktree`, `DELETE /experimental/worktree`, `POST /experimental/worktree/reset`, and `GET /experimental/resource`.
- `src/server/httpapi/file.ts` contains a real Effect `HttpApi` route slice for `GET /find`, `GET /find/file`, `GET /find/symbol`, `GET /file`, `GET /file/content`, `PUT /file/content`, and `GET /file/status`.
- `src/server/httpapi/mcp.ts` contains a real Effect `HttpApi` route slice for non-OAuth MCP management: `GET /mcp`, `POST /mcp`, `DELETE /mcp/:name/auth`, `POST /mcp/:name/connect`, `POST /mcp/:name/disconnect`, and `POST /mcp/:name/toggle`.
- `src/server/httpapi/project.ts` contains a real Effect `HttpApi` route slice for `GET /project`, `GET /project/current`, and `PATCH /project/:projectID`.
- `src/server/httpapi/provider.ts` contains a real Effect `HttpApi` route slice for `GET /provider`, `GET /provider/auth`, `POST /provider/:providerID/api`, and `DELETE /provider/:providerID/auth`.
- `src/server/httpapi/session.ts` contains a real Effect `HttpApi` route slice for session create/update/delete/fork/abort/revert/unrevert, read-only session routes, and non-streaming message/part JSON routes: `POST /session`, `DELETE /session/:sessionID`, `PATCH /session/:sessionID`, `POST /session/:sessionID/fork`, `POST /session/:sessionID/abort`, `POST /session/:sessionID/revert`, `POST /session/:sessionID/unrevert`, `GET /session`, `GET /session/status`, `GET /session/:sessionID`, `GET /session/:sessionID/children`, `GET /session/:sessionID/todo`, `GET /session/:sessionID/diff`, `GET /session/:sessionID/message`, `GET /session/:sessionID/message/:messageID`, `DELETE /session/:sessionID/message/:messageID`, `DELETE /session/:sessionID/message/:messageID/part/:partID`, and `PATCH /session/:sessionID/message/:messageID/part/:partID`.
- `src/server/httpapi/workspace.ts` contains a real Effect `HttpApi` route slice for workspace routes: `GET /experimental/workspace/adaptor`, `GET /experimental/workspace`, `POST /experimental/workspace/:id`, `DELETE /experimental/workspace/:id`, `POST /experimental/workspace/:id/restore`, and `POST /experimental/workspace/:id/session/:sessionID/restore`.
- `src/server/httpapi/public.ts` composes the implemented slices into one `PublicHttpApi`, covered by `bun test test/server/httpapi-public.test.ts`.
- `src/server/httpapi/bridge.ts` mounts the implemented top-level, config, doctor, experimental, file, MCP, project, provider, question, permission, session, TUI, loop, and workspace slices through `HttpRouter.toWebHandler` when `NIKCLI_EXPERIMENTAL_HTTPAPI=1`, and passes the active instance into the Effect context. The bridge matches exact method/path patterns so unported routes fall through to legacy Hono even while the flag is enabled. Coverage: `bun test test/server/`.
- The active server route files are still `src/server/routes/*.ts` and import Hono / `hono-openapi`.
- The current mount is an in-Hono experimental bridge after the existing instance/workspace middleware. The full backend-fork-at-startup path is still open.
- The route checklist below remains unchecked until the corresponding Effect `HttpApi` route is mounted through the experimental backend/bridge and covered by tests or SDK/OpenAPI verification.

Historical target state to reintroduce intentionally:

- `NIKCLI_EXPERIMENTAL_HTTPAPI` selects the backend at server startup. Default is still `hono`.
- `server/backend.ts` picks one of `effect-httpapi` or `hono`; `server.ts` builds either a pure Effect `HttpApi` web handler or the legacy Hono app accordingly. The earlier in-Hono "bridge" model has been replaced by this fork-at-startup.
- Legacy Hono routes remain mounted for the `hono` backend and remain the source for `hono-openapi` SDK generation.
- An Effect `HttpApi` OpenAPI surface exists (`OpenApi.fromApi(PublicApi)` in `cli/cmd/generate.ts --httpapi`, `NIKCLI_SDK_OPENAPI=httpapi` in `packages/sdk/js/script/build.ts`) but is **opt-in**. The 2026-07-08 flip-all attempt was rolled back 2026-07-09: at the time the Effect spec covered only the bridged route subset (23 SDK classes vs 78 from Hono), so generating the SDK from it dropped namespaces the TUI depends on and crashed it at startup.
- **2026-07-14 — full contract parity reached.** `public.ts` now exports two APIs: `PublicHttpApi.Api` (the *served* subset — every group has handlers and is bridged) and `PublicApi` (the *generation contract* — served groups plus contract-only groups with schemas but no handlers, for routes Hono still serves). Contract-only groups: `sync` (realigned to the real `routes/sync.ts` surface; the four invented Wave 4 endpoints `POST /sync/start|replay`, `GET /sync/history|snapshot` were dropped from spec, bridge, and generated clients — no callers existed), `auth`, `config-management`, `session-prompt`, `share`, `events`, `workspace-extra`, `users`, `pty-connect` (`httpapi/contract-extra.ts`), and `mobile` (all 84 `/mobile/*` ops, `httpapi/mobile.ts`). Every endpoint pins its operationId to the Hono value via `OpenApi.Identifier` (65 pre-existing endpoints were annotated too), and `generate.ts` injects the global `directory`/`workspace` optional query params that Hono's middleware adds to every operation. Result: Hono 280 ops vs Effect 281 (the extra one is `DELETE /session/:id/message/:messageID`, a real bridged endpoint Hono never described), **0 missing ops, 0 operationId mismatches**, and the hey-api SDK generated from the Effect spec has the **identical 78-class/method tree**. Repo-wide typecheck against the Effect-generated SDK passes everywhere except `@nikcli-ai/plugin`, which imports named domain types (`Event`, `Message`, `UserMessage`, `Part`, `Todo`, `Model`, `SessionStatus`) that the contract still types as `Schema.Unknown`. **The default SDK source stays Hono until those domain types exist as Effect Schemas (schema split)** — that is now the only flip blocker.
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

## Effect v4 / opencode Rules To Reuse

These rules come from `.opencode/references/effect-smol/migration`, `.opencode/references/effect-smol/packages/effect/HTTPAPI.md`, `.opencode/references/effect-smol/packages/effect/src/unstable/httpapi/*`, and opencode's `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md` route-pattern note.

- Use current Effect v4 imports: `effect/unstable/http`, `effect/unstable/httpapi`, and `@effect/platform-bun` for Bun server boundaries. Do not copy old `@effect/platform/HttpApi*` or v3 module paths.
- Use `Context.Service` for new services and define layers explicitly with `Layer.effect`, `Layer.succeed`, or `Layer.mergeAll`. Avoid relying on hidden default/dependency wiring.
- Keep stable services at the layer boundary. In `HttpApiBuilder.group(...)`, yield stable services once while constructing the handler layer, then close over them in handlers when practical. Do not rebuild stable layers with `Effect.provide(...)` inside request handlers.
- Use `Effect.gen(function* () { ... })` for multi-step handlers; use `yield* Service` for service access. For v4 yieldable values, use explicit module operations where required (`Fiber.join`, `Deferred.await`, `Ref.get`) instead of treating those values as Effects.
- Model SDK-visible failures as explicit schemas: prefer `Schema.TaggedErrorClass` or project API error schemas annotated with `HttpApiSchema.status(code)`. Use built-in `HttpApiError.*` only when the empty/tagged body is the intended wire shape.
- Add a shared `HttpApiMiddleware.layerSchemaErrorTransform` before changing validation error bodies. The default Effect response for schema failures is an empty 400, while Hono validators often return structured JSON.
- Move auth contracts to `HttpApiSecurity` and middleware (`basic`, `bearer`, and legacy `auth_token` query/api-key) so OpenAPI and runtime enforcement share one definition.
- Use `HttpApiSchema.asText({ contentType: "text/event-stream" })` plus `HttpServerResponse.stream(...)` for SSE that belongs in the typed API surface.
- Use `HttpApiBuilder.group(...).handleRaw(...)` for declared endpoints that need the raw request/response, especially websocket upgrades and compatibility routes that still need endpoint middleware and OpenAPI metadata.
- Use raw `HttpRouter.use(...)` only for routes outside the declared API surface, such as static UI fallbacks or temporary compatibility catch-alls.
- Prefer `HttpApiTest.groups(...)` for focused in-memory handler/client tests, and keep bridge-level `Server.App().fetch(...)` tests for auth, instance selection, and Hono-fallback behavior.
- Treat `BunHttpServer` as the final Bun-native server target: it wraps `Bun.serve`, scoped shutdown, streaming responses, multipart, file responses, and websocket upgrades under Effect services.

## Route Slice Checklist

Use this checklist for each small HttpApi migration PR:

1. Read the legacy Hono route and copy behavior exactly, including default values, headers, operation IDs, response schemas, and status codes.
2. Put the new `HttpApiGroup`, route paths, DTO schemas, and handlers in `src/server/httpapi/*`.
3. Add the group to `src/server/httpapi/public.ts` and add exact method/path patterns to `src/server/httpapi/bridge.ts` only for implemented routes.
4. Use request-provided context (`InstanceRef`, `InstanceState.context`, or `InstanceState.directory`, depending on the existing slice) inside HttpApi handlers instead of reading `Instance.directory`, `Instance.worktree`, or `Instance.project` ALS globals directly.
5. Reuse existing services directly. If a service returns plain objects, use `Schema.Struct`; use `Schema.Class` only when handlers return actual class instances.
6. Keep legacy Hono routes and `.zod` compatibility in place for SDK/OpenAPI generation.
7. Add tests that hit the Hono-mounted bridge via `Server.App().fetch(...)` when the route depends on auth, instance context, or fallback routing. Add `HttpApiTest.groups(...)` tests for focused schema/client round-trips when useful.
8. Run `bun test` for the new slice, `bun test test/server/` for bridge coverage, `bunx tsgo --noEmit` from `packages/nikcli`, and SDK generation when schema/OpenAPI output changes.

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
- Use v4 Schema names and shapes from `migration/schema.md`: `Schema.Literals([...])`, `Schema.Union([...])`, `Schema.Record(key, value)`, `Schema.String.check(Schema.isUUID())`, and `Schema.TaggedErrorClass`.
- Put status and content-type behavior on schemas with `HttpApiSchema.status(...)` / `httpApiStatus` and `HttpApiSchema.as*` helpers instead of duplicating status metadata in handlers.

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

| Area                      | Status            | Notes                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `question`                | `bridged`         | `src/server/httpapi/question.ts` implements list/reply/reject; covered directly and through `test/server/httpapi-bridge.test.ts`                                                                                                                                                        |
| `permission`              | `bridged`         | `src/server/httpapi/permission.ts` implements list/reply; covered directly and through `test/server/httpapi-bridge.test.ts`                                                                                                                                                             |
| `provider`                | `bridged` partial | `GET /provider`, `GET /provider/auth`, `POST /provider/:providerID/api`, and `DELETE /provider/:providerID/auth` are bridged; OAuth routes remain open                                                                                                                                  |
| `config`                  | `bridged`         | `GET /config`, `PATCH /config`, and `GET /config/providers` are bridged; Hono deletion remains open                                                                                                                                                                                     |
| `doctor`                  | `bridged`         | `GET /doctor` is bridged via `src/server/httpapi/doctor.ts`; covered by `test/server/httpapi-doctor.test.ts`                                                                                                                                                                            |
| `analytics`               | `bridged`         | all five read routes bridged via `src/server/httpapi/analytics.ts`; covered by `test/server/httpapi-analytics.test.ts`                                                                                                                                                                  |
| `global`                  | `bridged`         | `health`/`dispose` via `src/server/httpapi/global.ts`, `event` via raw SSE; served by the instance-less `handleGlobal` branch                                                                                                                                                           |
| `mission`                 | `bridged`         | full CRUD + lifecycle + execs bridged via `src/server/httpapi/mission.ts`; covered by `test/server/httpapi-mission.test.ts`                                                                                                                                                             |
| `project`                 | `bridged` partial | `GET /project`, `GET /project/current`, and `PATCH /project/:projectID` are bridged; checklist item `POST /project/git/init` is not registered on this branch                                                                                                                           |
| `file`                    | `bridged`         | read/search routes and `PUT /file/content` are bridged; Hono deletion remains open                                                                                                                                                                                                      |
| `mcp`                     | `bridged`         | all management + OAuth routes bridged: status, add, startAuth, authCallback, authenticate, removeAuth, connect, disconnect, toggle                                                                                                                                                      |
| `workspace`               | `bridged` partial | adaptor/list plus create/remove/restore/session-restore routes are bridged; `GET /experimental/workspace/status` is still unchecked because no matching Hono registration was found                                                                                                     |
| top-level instance routes | `bridged`         | `POST /instance/dispose`, `GET /path`, `GET /vcs`, `GET /vcs/status`, `GET /vcs/diff/raw`, `POST /vcs/apply`, `GET /command`, `GET /agent`, `GET /skill`, `GET /lsp`, and `GET /formatter` are bridged                                                                                  |
| experimental JSON routes  | `bridged` partial | `tool/ids`, `tool`, `worktree` create/list/remove/reset, and `resource` routes are bridged; console routes and global session list remain open                                                                                                                                          |
| `session`                 | `bridged` partial | create/update/delete/fork/abort/revert/unrevert/list/status/get/children/todo/diff/messages plus single-message and part JSON routes are bridged; prompt, share, init, summarize, shell, and command routes remain Hono                                                                 |
| `sync`                    | `bridged` partial | 4 new endpoints bridged via `httpapi/sync.ts` (Wave 4, 2026-07-08). `/sync/stream` (SSE) stays Hono "special". Legacy `/sync/event`, `/sync/outbox`, `/sync/snapshot/:aggregateID`, `/sync/stats`, `/sync/config`, `/sync/connect`, `/sync/disconnect`, `/sync/drain` remain Hono-only. |
| `event`                   | `not ported`      | current implementation uses Hono SSE                                                                                                                                                                                                                                                    |
| `pty`                     | `special`         | current implementation uses Hono websocket                                                                                                                                                                                                                                              |
| `tui`                     | `special`         | current implementation is a Hono UI bridge                                                                                                                                                                                                                                              |

## Full Route Checklist

This checklist tracks bridge parity only. Checked routes are available through the experimental `HttpApi` bridge; Hono deletion is tracked separately by the deletion checklist above.

### Top-Level Instance Routes

- [x] `POST /instance/dispose` - dispose active instance. Current branch behavior disposes inline before returning JSON; post-response lifecycle remains a Hono deletion criterion.
- [x] `GET /path` - current directory and worktree paths.
- [x] `GET /vcs` - current VCS status.
- [ ] `GET /vcs/diff` - VCS diff summary. Current branch audit: no matching Hono registration found in `src/server/server.ts`; keep unchecked until removed from inventory or reintroduced intentionally.
- [x] `GET /vcs/status` - changed files without patches. Evidence: `src/server/httpapi/top-level.ts` `vcsStatus` and `bun test test/server/httpapi-top-level.test.ts`.
- [x] `GET /vcs/diff/raw` - raw patch served as `text/x-diff` via `HttpApiSchema.asText`.
- [x] `POST /vcs/apply` - apply patch; `VcsPatchApplyError` maps to the legacy `{ name: "VcsApplyError", data: { message, reason } }` 400 body.
- [x] `GET /command` - command catalog.
- [x] `GET /agent` - agent catalog.
- [x] `GET /skill` - skill catalog.
- [x] `GET /lsp` - LSP status.
- [x] `GET /formatter` - formatter status.

### Config Routes

- [x] `GET /config` - read config.
- [x] `PATCH /config` - update config and dispose active instance. Current branch behavior disposes inline before returning JSON; post-response lifecycle remains a Hono deletion criterion.
- [x] `GET /config/providers` - config provider summary.

### Doctor Routes

- [x] `GET /doctor` - run diagnostics and return the structured doctor report. Evidence: `src/server/httpapi/doctor.ts`, `src/server/httpapi/bridge.ts`, and `bun test test/server/httpapi-doctor.test.ts`.

### Analytics Routes

- [x] `GET /analytics/global` - cumulative global analytics. Evidence: `src/server/httpapi/analytics.ts` and `bun test test/server/httpapi-analytics.test.ts`.
- [x] `GET /analytics/daily` - daily snapshots with the legacy `from`/`to`/`days` defaulting.
- [x] `GET /analytics/session/:sessionID` - session analytics; missing session returns the legacy `{ error: "Session not found" }` 404 body.
- [x] `GET /analytics/sessions` - all session summaries.
- [x] `GET /analytics/leaderboard` - ranked models/providers/projects.

### Global Routes

Served by the instance-less `supportsGlobal`/`handleGlobal` bridge branch (mounted before the instance middleware in `server.ts`).

- [x] `GET /global/health` - health + version. Evidence: `src/server/httpapi/global.ts` and `bun test test/server/httpapi-global.test.ts`.
- [x] `POST /global/dispose` - dispose all instances and emit `global.disposed`.
- [x] `GET /global/event` - global SSE stream via `HttpApiEvent.handle()` (raw response, not `HttpApi`).

### Mission Routes

- [x] `GET /mission` - list missions with runtime status. Evidence: `src/server/httpapi/mission.ts` and `bun test test/server/httpapi-mission.test.ts`.
- [x] `GET /mission/templates` - built-in templates.
- [x] `POST /mission/generate` - generate a definition from a description (errors map to the legacy `ValidationError` 400 body, same as the loop slice).
- [x] `GET /mission/:id` - get mission + runtime; legacy `NotFound` 404 body.
- [x] `PUT /mission` - create; body parsed with the legacy zod `CreateInput` so schema defaults apply.
- [x] `POST /mission/:id` - update; path/body id mismatch and validation failures map to the legacy 400 body.
- [x] `DELETE /mission/:id` - delete (cancels in-flight orchestration first).
- [x] `POST /mission/:id/start` - start/resume orchestration.
- [x] `POST /mission/:id/pause` - pause.
- [x] `POST /mission/:id/cancel` - cancel and freeze.
- [x] `POST /mission/:id/feature/:featureID` - feature mutation (skip / mark-done / reset / add deps).
- [x] `GET /mission/:id/execs` - execution history.
- [x] `GET /mission/execs/recent` - recent executions across missions.

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

- [x] `POST /sync/start` - start remote hub sync. Evidence: `src/server/httpapi/sync.ts` `Sync.Service.start` (Wave 4, 2026-07-08).
- [x] `POST /sync/replay` - manual outbox append. Evidence: `src/server/httpapi/sync.ts` `Sync.Service.push` (Wave 4, 2026-07-08).
- [x] `GET /sync/history` - paginated sync event history. Evidence: `src/server/httpapi/sync.ts` `Sync.Service.outbox` (Wave 4, 2026-07-08).
- [x] `GET /sync/snapshot` - cold-start projection snapshot. Evidence: `src/server/httpapi/sync.ts` `Sync.Service.snapshot` (Wave 4, 2026-07-08).
- [ ] `GET /sync/stream` - SSE feed; replace with raw Effect HTTP/streaming (parallel to `/event`). See `specs/effect/sync-service.md` §4 "SSE branch stays out of the schema layer".

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
- [x] `POST /session/:sessionID/message` - prompt with streaming response. Evidence: `src/server/httpapi/prompt.ts` (chunked 200 opened immediately, final message JSON written at completion; validator-compatible 400), served from `bridge.ts`.
- [x] `POST /session/:sessionID/prompt_async` - async prompt. Evidence: `src/server/httpapi/prompt.ts` (validates, fires in background, returns 204).
- [x] `POST /session/:sessionID/command` - run command. Evidence: `src/server/httpapi/session.ts` `command` (BusyError maps to the declared 409).
- [x] `POST /session/:sessionID/shell` - run shell command. Evidence: `src/server/httpapi/session.ts` `shell`.
- [x] `POST /session/:sessionID/revert` - revert message. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session/:sessionID/unrevert` - restore reverted messages. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
- [x] `POST /session/:sessionID/permissions/:permissionID` - deprecated permission response route. Evidence: `src/server/httpapi/session.ts` `permissionRespond` (thin alias of permission.reply, kept for SDK compatibility).

### Event Routes

- [x] `GET /event` - SSE event stream without Hono. Evidence: `src/server/httpapi/event.ts`, served from `bridge.ts`, covered in `test/server/httpapi-bridge.test.ts`.

### PTY Routes

- [x] `GET /pty` - list PTY sessions. Evidence: `src/server/httpapi/pty.ts` `pty.list` (Wave 4 Path B, 2026-07-08).
- [x] `POST /pty` - create PTY session. Evidence: `src/server/httpapi/pty.ts` `pty.create` (Wave 4 Path B, 2026-07-08).
- [x] `GET /pty/:ptyID` - get PTY session. Evidence: `src/server/httpapi/pty.ts` `pty.get` with declared 404 (Wave 4 Path B, 2026-07-08).
- [x] `PUT /pty/:ptyID` - update PTY session. Evidence: `src/server/httpapi/pty.ts` `pty.update` (Wave 4 Path B, 2026-07-08).
- [x] `DELETE /pty/:ptyID` - remove PTY session. Evidence: `src/server/httpapi/pty.ts` `pty.remove` (Wave 4 Path B, 2026-07-08).
- [ ] `GET /pty/:ptyID/connect` - PTY websocket; replace with raw Effect HTTP/websocket support (blocked on `BunHttpServer.upgradeWebSocket`). CRUD landed first per Path B — see `specs/effect/pty-httpapi.md`.

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
9. [x] Bridge sync start/replay/history/snapshot routes. Evidence: `src/server/httpapi/sync.ts`, `Sync.Service`, and `bun run script/httpapi-bridge-inventory.ts` (41 checks passed, 2026-07-08).
10. [x] Bridge session read routes: list, status, get, children, todo, diff, and messages are bridged. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
11. [x] Bridge session lifecycle mutation routes: create, delete, update, fork, and abort are bridged. Evidence: `src/server/httpapi/session.ts` and `bun test test/server/httpapi-session.test.ts`.
12. [x] Bridge remaining session mutation routes: share/unshare/summarize/command/shell/deprecated-permissions are bridged (2026-06-12); init was removed by design. Only the streaming prompt routes (`POST /session/:id/message`, `POST /session/:id/prompt_async`) remain, tracked with the SSE work in step 13.
13. [x] Replace event SSE with non-Hono HTTP (2026-06-12): `src/server/httpapi/event.ts` serves `GET /event` from the bridge as a web-standard ReadableStream SSE response (server.connected greeting, GlobalBus forwarding, 30s heartbeat) — no Hono dependency. The streaming prompt routes (`POST /session/:id/message`, `prompt_async`) follow the same raw-response pattern when they move.
14. [x] Bridge doctor route. Evidence: `src/server/httpapi/doctor.ts`, `src/server/httpapi/bridge.ts`, and `bun test test/server/httpapi-doctor.test.ts`.
15. [x] `/pty` CRUD Path B landed (Wave 4; see `specs/effect/pty-httpapi.md`). CRUD endpoints (`list/create/get/update/remove`) live in `httpapi/pty.ts` mirroring `routes/pty.ts`. The WebSocket upgrade at `GET /pty/:ptyID/connect` stays a Hono "special" branch served ahead of the schema router (parallel to `HttpApiEvent.handle()`). Two options:

    - **Option A (preferred)**: keep the WS on the Effect backend by adapting `hono/bun`'s `upgradeWebSocket` via `HttpApiBuilder.handleRaw` — declared endpoint stays in the OpenAPI surface, runtime closes over the upgraded socket via `Effect.async`. Depends on `BunHttpServer` exposing an Effect-native WS upgrade.
    - **Option B** (interim, **adopted 2026-07-08**): switch the CRUD surface to `HttpApi` while `/pty/:id/connect` continues to fall through to the Hono `PtyRoutes`. Smaller diff, no BunHttpServer dependency.
      Backend-flip work must preserve this explicit special until Effect/Bun websocket upgrade exists.

16. [ ] Replace tui bridge routes or explicitly isolate them behind a non-Hono compatibility layer for the Effect backend. Hono `tui.ts` remains in the Hono backend.
17. [x] `/sync` JSON surface landed (Wave 4; see `specs/effect/sync-service.md`). `Sync.Service` extraction is present; JSON routes live in `httpapi/sync.ts`. The `eventlog` table is the natural candidate since `syncEvent` rows are already written through a Drizzle-backed store; see `src/sync/sync.sql.ts`. The service exposes:

    - `start({ url, token, projectID })`: kick the hub connection, idempotent
    - `push(projectID, { aggregate, data, origin? })`: write to local outbox + emit on `GlobalBus("event")`
    - `outbox(projectID, aggregate, since, limit?)`: paginated GET
    - `snapshot(aggregate, projectID)`: cold-start projection snapshot (already implemented at `SyncProjection.byAggregate`)
    - `state()`: configured/url/pending/failed stats
      Routes `/sync/start`, `/sync/replay`, `/sync/history`, `/sync/snapshot` are in `httpapi/sync.ts`; `/sync/stream` stays a Hono "special" SSE branch parallel to `httpapi/event.ts` until an Effect raw-stream backend path is selected.

18. [ ] Switch OpenAPI/SDK generation to Effect routes and compare SDK output. Effect path is implemented and opt-in via `--httpapi` / `NIKCLI_SDK_OPENAPI=httpapi`. A 2026-07-08 default flip was rolled back 2026-07-09 because the Effect surface lacks route parity (23 SDK classes vs 78) and the regenerated SDK crashed the TUI. Reach route parity in `PublicHttpApi` first, close the schema-shape gaps in `public.ts` (branded `pattern`, per-property `description`, `Event.*` / `SyncEvent.*` naming, dedup collisions), then flip `packages/sdk/js/script/build.ts` default.
19. [ ] Flip `backend.ts` default from `hono` to `effect-httpapi`, keep `NIKCLI_EXPERIMENTAL_HTTPAPI` (or its inverse) as a short fallback flag, then delete replaced Hono route files.

## Checklist

- [x] Add first `HttpApi` JSON route slices. Evidence: `src/server/httpapi/question.ts` plus `bun test test/server/httpapi-question.test.ts`.
- [x] Bridge selected `HttpApi` routes behind `NIKCLI_EXPERIMENTAL_HTTPAPI`. Evidence: `src/server/httpapi/bridge.ts` and `bun test test/server/httpapi-bridge.test.ts`. This is an in-Hono experimental bridge; backend-fork-at-startup remains open.
- [x] Reuse existing Effect services in implemented handlers. Evidence: `QuestionHttpApi` yields `Question.Service`, `PermissionHttpApi` yields `PermissionNext.Service`, and `bun test test/server/httpapi-question.test.ts test/server/httpapi-permission.test.ts test/server/httpapi-public.test.ts` passes.
- [x] Provide auth, instance lookup, and observability in the Effect route layer. Evidence: bridge-level basic-auth shim in `src/server/httpapi/bridge.ts` `handle()` runs before the router when `Flag.NIKCLI_SERVER_PASSWORD` is set.
- [x] Centralize auth via shared helpers in `src/server/httpapi/auth.ts` (mirrors the Hono basic-auth middleware in `server.ts`).
- [x] Support `auth_token` as a query security scheme. Evidence: `Auth.extractQueryToken(url)` parses `?token=` and is referenced by `/sync/*` and `/chatbot/*` webhook receivers.
- [x] Add bridge-level auth and instance tests. Evidence: `bun test test/server/httpapi-bridge-auth.test.ts` covers `Auth.matchesBasicAuth` (valid/invalid header shapes), `Auth.extractQueryToken` (`token=…` parsing), and `HttpApiBridge.supports`/`supportsGlobal` for every Wave 3 group.
- [x] Complete exact Hono route inventory. Evidence: `bun run script/httpapi-bridge-inventory.ts` (31 cases including Wave 3a brain/connectors/chatbot/users/managed-worktree) and `specs/httpapi-bridge-inventory.md` mirror table.
- [x] Resolve implemented-but-unmounted route groups. Evidence: `rg --files src/server/httpapi` lists only active route slices plus `public` and `bridge`; current slices `top-level`, `config`, `experimental`, `file`, `mcp`, `project`, `provider`, `question`, `permission`, and `workspace` are bridged.
- [x] Port current top-level JSON reads. Evidence: `src/server/httpapi/top-level.ts` and `bun test test/server/httpapi-top-level.test.ts`. `GET /vcs/diff` is not present in the current Hono route registration and remains an inventory cleanup item.
- [x] Implement Effect `HttpApi` OpenAPI generation behind `--httpapi` / `NIKCLI_SDK_OPENAPI=httpapi`. Evidence: `src/cli/cmd/generate.ts` opt-in branch and `packages/sdk/js/script/build.ts` env passthrough (2026-07-08).
- [ ] Close Effect-vs-Hono OpenAPI schema-shape gaps and flip the SDK generator default.
- [ ] Flip the runtime backend default from `hono` to `effect-httpapi`, with a short fallback flag.
- [ ] Delete replaced Hono route implementations.
- [ ] Replace SSE/websocket/streaming Hono routes with non-Hono implementations (or remove with the rest of Hono).

### B6 deletion readiness (2026-07-08)

Source of truth: `src/server/backend.ts` `ServerBackend.honoDeletionGroups`.

B4 bridge reuse: `src/server/httpapi/bridge.ts` now exports `HttpApiBridge.layer`
and `HttpApiBridge.webHandler`, so the eventual pure Effect backend can mount the
same `PublicHttpApi.layer` wiring used by the in-Hono bridge instead of duplicating
Bun platform layers.

B4 PoC runtime: `src/server/backend-runtime.ts` adds `BackendRuntime.serverLayer`
and `BackendRuntime.launch(port, hostname)` that mount `HttpApiBridge.layer` on
`BunHttpServer.layer({ port, hostname, idleTimeout: 0 })`. Smoke test in
`test/server/backend-runtime.test.ts`. The production Hono path is untouched;
this is the scaffold for the future full Effect backend.

Candidate groups are **not** deletable until the SDK generator default flips to Effect OpenAPI; `ServerBackend.canDeleteHonoGroup(..., { sdkDefaultHttpApi: false })` must remain `false`. (The 2026-07-08 SDK default flip was rolled back 2026-07-09 pending route parity.)

| Group            | Status    | Notes                                      |
| ---------------- | --------- | ------------------------------------------ |
| doctor           | candidate | JSON-only, bridged                         |
| analytics        | candidate | JSON-only, bridged                         |
| brain            | candidate | JSON-only, bridged                         |
| connectors       | candidate | JSON-only, bridged                         |
| pty-websocket    | blocked   | WS special `/pty/:id/connect` remains Hono |
| sync-stream      | blocked   | SSE/legacy sync remains Hono               |
| companion-mobile | blocked   | HTML/mobile separate surfaces              |
