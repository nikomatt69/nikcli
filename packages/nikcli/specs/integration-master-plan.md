# Integration Master Plan

Single authoritative document for all remaining work in `packages/nikcli`. Synthesized
from every spec in `specs/effect/`, `specs/v2/`, `specs/openapi-translation-cleanup.md`,
and `specs/tui-plugins.md`.

Runtime: **Bun only**. No Node.js shims, no `child_process`, no `fs` outside Effect
services. Every async boundary uses Bun primitives or `@effect/platform-bun`.

Validation invariant per epoch: `bun run typecheck` exits 0 before moving forward.

---

## State Snapshot — 2026-05-15

### Complete

| Area | Evidence |
|------|----------|
| Effect 4.0.0-beta.65 upgrade (Phase Q) | 0 type errors, all 19 packages |
| Service shape migrations (39 services) | migration.md checklist |
| Phase J: all tool parameter schemas | schema.md tool section |
| Phase F: Instance.provide entry boundaries (21 files) | MASTER-PLAN.md |
| Phase K1: MCP OAuth bridge | httpapi/mcp.ts |
| HttpApi bridge slices: question, permission, config, project, provider, file, mcp, session CRUD, workspace, experimental | httpapi/ directory |
| OpenAPI translation PRs 1+2 (drift tests + InstanceQueryParameters removal) | openapi-translation-cleanup.md |
| Phase A1–A3: Filesystem, lazy, env consolidation | MASTER-PLAN.md |
| Phase B1–B4: config/tui config consolidation | MASTER-PLAN.md |
| Phase E: schema leaf files | schema.md |
| **E1-A**: NamedError.create → Schema.TaggedErrorClass for all service errors | commit `6de3069` |
| **E1-B**: NamedError.Unknown → EventError helpers; wire format aligned to "UnknownError" | commit `6de3069` |
| **E1-C Step 1**: LSP leaf schemas (Range, Symbol, DocumentSymbol) → Effect Schema via zodObject | `src/lsp/index.ts`; fix in `effect-zod.ts` FieldToZod input type |

### Still Open (this plan)

Everything below is **not done** and is ordered by dependency.

---

## Epoch 1 — Error System + Schema Foundations

These are independent streams that can run in parallel. Complete both before Epoch 2.

### E1-A: Typed Error Conversion (P0 priority)

Convert remaining `NamedError.create(...)` service errors to `Schema.TaggedErrorClass`.
Each conversion is a vertical slice: domain class → method signature → HTTP boundary →
middleware shrink → tests.

Order (smallest blast radius first):

1. **`src/config/error.ts` + `src/config/config.ts` + `src/config/markdown.ts`**
   — config errors already render well in CLI; keep diagnostics intact.
   Class names: `ConfigNotFoundError`, `ConfigParseError`, `ConfigMergeError` (audit with
   `rg "NamedError" src/config`).

2. **`src/storage/db.ts`** — `NotFoundError`. Tiny; already modeled on `storage/storage.ts`
   `NotFoundError` shape.

3. **`src/mcp/index.ts`** — `MCPFailed`. One class; callers in `session/prompt.ts` and
   MCP routes map it at the boundary.

4. **`src/skill/index.ts`** — `SkillInvalidError`, `SkillNameMismatchError`.

5. **`src/lsp/client.ts`** — `LSPInitializeError`.

6. **`src/ide/index.ts`** — install errors.

7. **`src/provider/provider.ts`** — `ProviderInitError`.

For each:

```ts
// Before
export const SomethingError = NamedError.create("SomethingError", { ... })

// After
export class SomethingError extends Schema.TaggedErrorClass<SomethingError>()(
  "SomethingError",
  { field: Schema.String, cause: Schema.optional(Schema.Defect) },
) {}
```

- Service method signatures expose the typed error in their return type.
- HTTP handlers catch the tag and map to a declared API error.
- Generic HTTP middleware does **not** grow new name-based domain knowledge.
- Delete the corresponding `NamedError` branch from error middleware after the handler
  owns the mapping.

Acceptance: `rg "NamedError.create" src` returns only session wire helpers and bridge
compat until E1-B is done.

### E1-B: Session/Message Wire Error Helpers

Create `src/session/event-error.ts` with narrow typed helpers for model-visible error
shapes. These are **not** service errors; they own the `{ name, data }` wire shape for
session events and assistant messages.

```ts
// src/session/event-error.ts
export const unknown = (message: string) => ({ name: "Unknown", data: { message } })
export const agentNotFound = (agent: string, available: string[]) => ({ ... })
export const commandNotFound = (command: string, available: string[]) => ({ ... })
export const modelNotFound = (err: Provider.ModelNotFoundError) => ({ ... })
```

Replace every `new NamedError.Unknown(...).toObject()` in `session/prompt.ts`,
`session/message-error.ts`, and config/skill/plugin session event publishing with these
helpers. Update retry/message tests to assert the helper output shape, not NamedError
instances.

Acceptance: `rg "NamedError.Unknown" src` returns no matches.

### E1-C: Session Domain Schema Migration (Phase P, session cluster)

The session cluster is the largest remaining Phase P surface and directly blocks the SDK
flip. Migrate leaf-first per `schema.md` ordering:

**Step 1** — LSP + snapshot leaf schemas (unblock message-v2):
- `src/lsp/lsp.ts` — `LSP.Range`, `LSP.Location` as Effect Schema.
- `src/snapshot/index.ts` — `Snapshot.FileDiff`, `Snapshot.Patch` (Patch already
  migrated; verify `FileDiff` shape).

**Step 2** — `src/session/message-v2.ts`
Extract and migrate leaf objects first (output format payloads, PartBase, time helpers,
token/cost/model objects), then part variants (SnapshotPart, PatchPart, TextPart,
ReasoningPart, FilePart, AgentPart, CompactionPart, SubtaskPart), then higher-level
unions (FilePartSource, part unions, message unions, assistant/user payloads). Effect
Schema is the source of truth; derive `.zod` via `zodObject(...)` for the SSE/OpenAPI
boundary only.

**Step 3** — Remaining session files in order:
- `src/session/message.ts`
- `src/session/prompt.ts`
- `src/session/revert.ts`
- `src/session/summary.ts`
- `src/session/status.ts`
- `src/session/todo.ts`
- `src/session/session.ts`
- `src/session/compaction.ts`

For each file: declare `Schema.Struct(...)` or `Schema.Class(...)`, expose
`zodObject(...)`/`zod(...)` for remaining zod boundaries, run
`bun run typecheck`, then verify SDK byte-identity with
`bun packages/sdk/js/script/build.ts`.

**Step 4** — Remaining Phase P surfaces (can overlap with Step 3):
- Provider domain: `src/provider/models.ts`, `src/provider/provider.ts`.
- Config domain: skills, formatter, console-state, mcp, lsp, model-id, command, plugin,
  provider sections of config schema.
- Bus events: `src/bus/bus-event.ts`, `src/bus/index.ts`.
- Control-plane types: `src/control-plane/types.ts`, `src/control-plane/workspace.ts`.
- Misc: `src/sync/index.ts`, `src/id/id.ts`, `src/util/fn.ts`, `src/util/log.ts`,
  `src/util/update-schema.ts`, `src/command/index.ts`.
- Server route DTO files (every file in `src/server/routes/`): these become mechanical
  once the domain side is done — switch to `.zod` derived from the Schema-migrated domain
  types.

SDK byte-identity gate applies to every file: no deliberate diff may land without
documented intent.

---

## Epoch 2 — Services + Instance Context

Start after E1-A and E1-C (Step 1–2) are green.

### E2-A: Sync.Service + Workspace.Service (Phase I)

**`src/sync/index.ts`** — `Sync.Service` with `start`, `replay`, `history`, `publish`.
Backed by `InstanceState`. Effect Schema for event payloads (leverage Phase P bus/sync
schemas from E1-C Step 4). No module-level singletons.

```ts
export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<void, SyncError>
  readonly replay: (input: ReplayInput) => Effect.Effect<SyncEvent[], SyncError>
  readonly history: (input: HistoryInput) => Effect.Effect<SyncEvent[], SyncError>
  readonly publish: (event: SyncEvent) => Effect.Effect<void, never>
}
```

**`src/control-plane/workspace.ts`** — `Workspace.Service` with `list`, `create`,
`remove`, `restore`, `restoreSession`, `status`. Backs `httpapi/workspace.ts` end-to-end.
Use `InstanceState`-backed per-directory state. Remove legacy adapter layer.

Both services require focused test coverage (`bun test test/sync/...`,
`bun test test/workspace/...`).

### E2-B: ScopedCache Boot Cache (Phase G)

Replace `cache: Map<string, Promise<Context>>` in `src/project/instance.ts` with
`Effect.ScopedCache`:

```ts
const cache = yield* Effect.ScopedCache.make({
  capacity: Number.MAX_SAFE_INTEGER,
  timeToLive: Duration.infinity,
  lookup: (directory: string) => makeInstanceLayer(directory),
})
```

`Instance.provide({directory, fn})` becomes `AppRuntime.runPromise(Effect.gen(function*() {
  const ctx = yield* cache.get(directory); return yield* Effect.promise(() => contextProvide(ctx, fn))
}))`.

`Instance.dispose()` → `cache.invalidate(directory)` (scope finalizer fires disposers).
`Instance.disposeAll()` → `cache.invalidateAll()`.

Risks to validate with focused tests before landing:
- Concurrent `Instance.provide` for same directory deduplicates via fiber-join.
- `Instance.dispose()` fired while boot in-flight.
- `init?` callback runs exactly once per directory.

ALS-backed `Instance.directory/worktree/project` reads stay temporarily (Phase H cleans
them up after this lands).

### E2-C: HTTP Error Boundary Reduction

After E1-A + E1-B, reduce the generic HTTP error middleware:

1. Convert `Session.BusyError` to `Schema.TaggedErrorClass` and map it at session route
   boundaries (not middleware).
2. Delete the broad `NamedError` middleware branch — it must no longer have callers that
   produce defect-wrapped legacy domain errors.
3. Keep exactly one final unknown-defect fallback that logs `Cause.pretty(cause)` and
   returns a safe `500` body.
4. Verify `bun test test/server/httpapi-*.test.ts` still passes end-to-end.

---

## Epoch 3 — HttpApi Route Parity

Start after Epoch 2. All routes use Bun-native `@effect/platform-bun` runtime.

### E3-A: Session Remaining Routes (K6)

Bridge the remaining session routes not yet in `src/server/httpapi/session.ts`:

| Route | Notes |
|-------|-------|
| `POST /session/:sessionID/init` | run project init command |
| `POST /session/:sessionID/share` | requires `ShareNext.Service` |
| `DELETE /session/:sessionID/share` | unshare session |
| `POST /session/:sessionID/summarize` | requires `SessionSummary.Service` |
| `POST /session/:sessionID/prompt_async` | async prompt (non-streaming) |
| `POST /session/:sessionID/command` | run command |
| `POST /session/:sessionID/shell` | run shell command via Bun |
| `POST /session/:sessionID/permissions/:permissionID` | deprecated reply route |

Each handler:
- Uses `InstanceState.context` / `InstanceState.directory` — no `Instance.*` ALS reads.
- Declares typed domain errors in the endpoint error schema.
- Has bridge-level test coverage (`bun test test/server/httpapi-session.test.ts`).

Streaming session prompt (`POST /session/:sessionID/message`) goes in E3-B/M1 with the
SSE work.

### E3-B: Sync Routes (K4)

After E2-A (`Sync.Service` exists):

- `POST /sync/start` — wires `Sync.Service.start`.
- `POST /sync/replay` — wires `Sync.Service.replay`.
- `POST /sync/history` — wires `Sync.Service.history`.

Located in `src/server/httpapi/sync.ts`. Mounted through `bridge.ts`. Tests at
`bun test test/server/httpapi-sync.test.ts`.

### E3-C: Event SSE (M1)

Replace Hono SSE in `src/server/event.ts` with raw `@effect/platform-bun` HTTP streaming.
Use `HttpServerResponse.stream(stream, { contentType: "text/event-stream" })` or the
equivalent `BunHttpServer` streaming primitive.

The Effect backend serves `GET /event` via this handler; the Hono fallback keeps the
existing `streamSSE` until the backend default flips (Phase L).

Write SSE framing as a pure `Stream.Stream<string>` transformer so the bus subscription
stays testable without an HTTP layer.

### E3-D: PTY WebSocket (M2)

Replace Hono WebSocket in PTY routes with `@effect/platform-bun` WebSocket support.
`Pty.Service` already exposes the right Effect surface; the route becomes a WebSocket
upgrade that pipes PTY input/output through the bun WebSocket handler.

Routes to implement in `src/server/httpapi/pty.ts`:
- `GET /pty` — list PTY sessions.
- `POST /pty` — create PTY session.
- `GET /pty/:ptyID` — get PTY session.
- `PUT /pty/:ptyID` — update PTY session (resize).
- `DELETE /pty/:ptyID` — remove PTY session.
- `GET /pty/:ptyID/connect` — WebSocket upgrade; pipes to `Pty.Service`.

### E3-E: TUI Control Routes (M3)

TUI control routes in `src/server/httpapi/tui.ts`. These are short-lived HTTP POSTs that
trigger TUI state changes via the internal event bus; no WebSocket needed.

Routes: `append-prompt`, `open-help`, `open-sessions`, `open-themes`, `open-models`,
`submit-prompt`, `clear-prompt`, `execute-command`, `show-toast`, `publish`,
`select-session`, `control/next` (long-poll), `control/response`.

If any route depends on a Hono-specific compatibility behavior, keep it in a Hono island
explicitly documented as non-Effect until a clean replacement exists.

---

## Epoch 4 — OpenAPI/SDK Flip (Phase L)

Start after Epoch 3 is complete and all bridged routes pass tests.

### E4-A: Close OpenAPI Schema-Shape Gaps

Fix the delta between Effect-generated and Hono-generated OpenAPI in `public.ts`:

1. **Branded-type patterns** — add `Schema.pattern(regex)` annotation to each ID type in
   `src/id/id.ts` so `OpenApi.fromApi` emits the same `pattern` constraints as the Hono
   `describeRoute` metadata (~169 entries).
2. **Per-property descriptions** — add `.annotate({ description })` to each Schema.Struct
   field that currently gets its description from the Hono validator (~107 entries).
3. **Component naming** — `Event.*` / `SyncEvent.*` use dotted form in Hono and PascalCase
   in Effect. Either fix the Effect naming at source (preferred) or add a narrow name-map
   in `public.ts` documented as a compatibility shim.
4. **Dedup collisions** — fix the numbered-duplicate component emitter in effect-smol or
   handle them with a post-process deduper that uses stable names.
5. **Cosmetic diffs** — `additionalProperties: false`, `const` vs `enum`,
   MAX_SAFE_INTEGER `maximum`, `propertyNames` — normalize in `public.ts` only when
   removing them would change SDK output.

Gate: `bun packages/sdk/js/script/build.ts --diff` emits zero unexpected lines.

### E4-B: OpenAPI Translation Cleanup PRs 3–7

Implement in this order per `openapi-translation-cleanup.md`:

**PR 3** — Replace broad `QueryNumberParameters`/`QueryBooleanParameters` with
route-level schema helpers. Keep overrides only where SDK compatibility requires a
specific encoded type.

**PR 4** — Move path parameter patterns into ID schemas. Target IDs already listed as
done (`sessionID`, `messageID`, etc.) are verified; add remaining ones.

**PR 5** — Replace built-in error rewrites with declared API errors by route group.
Start with `groups/config.ts`, `groups/session.ts`. Use `src/server/httpapi/errors.ts`
helpers (`notFound`, `badRequest`, `unknown`).

**PR 6** — Auth/security spec rewrites: decide whether to expose auth metadata in SDK.
If preserving no-auth SDK surface, document it as intentional and add test.

**PR 7** — Component shape rewrites one at a time: `normalizeComponentDescriptions` (if
safe), `applyLegacySchemaOverrides` narrowing, `stripOptionalNull` only with explicit
migration plan.

### E4-C: Backend Fork + SDK Generation Flip

1. Restore `src/server/backend.ts` that forks at startup between `effect-httpapi` and
   `hono` (controlled by `NIKCLI_EXPERIMENTAL_HTTPAPI`).
2. Make Effect HttpApi OpenAPI generation the default when
   `NIKCLI_SDK_OPENAPI=httpapi` is set.
3. Run `bun packages/sdk/js/script/build.ts` with httpapi source and compare against
   pre-flip baseline. Accept only intentional diffs.
4. Flip `packages/sdk/js/script/build.ts` default to `httpapi`.
5. Regenerate and check in updated `packages/sdk/js/src/v2/gen/types.gen.ts`.
6. Flip `backend.ts` default from `hono` to `effect-httpapi`. Keep
   `NIKCLI_EXPERIMENTAL_HTTPAPI=0` as a temporary fallback flag.

---

## Epoch 5 — Hono Deletion (Phase N)

Each group requires:

1. `HttpApi` route mounted by default (not only behind flag).
2. Bridge tests cover auth, instance selection, success, and side effects.
3. OpenAPI/SDK generation uses Effect route for that path.
4. Generated SDK diff is zero or explicitly accepted.

Deletion order (ascending blast radius):

| Group | Files |
|-------|-------|
| top-level instance reads | `src/server/routes/top-level.ts` |
| config | `src/server/routes/config.ts` |
| project | `src/server/routes/project.ts` |
| provider | `src/server/routes/provider.ts` |
| question | `src/server/routes/question.ts` |
| permission | `src/server/routes/permission.ts` |
| file | `src/server/routes/file.ts` |
| mcp | `src/server/routes/mcp.ts` |
| experimental | `src/server/routes/experimental.ts` |
| workspace | `src/server/routes/workspace.ts` |
| sync | `src/server/routes/sync.ts` |
| session | `src/server/routes/session.ts` |
| event | `src/server/routes/event.ts` |
| pty | `src/server/routes/pty.ts` |
| tui | `src/server/routes/tui.ts` |

Per file: remove `describeRoute` + validator + handler, remove `.route(...)` registration,
delete duplicate Zod-only DTOs, regenerate SDK, verify no diff.

Final step: remove Hono import + `cors` + `basicAuth` + `streamSSE` + `proxy` from
server bootstrap once nothing depends on them.

---

## Epoch 6 — ALS Cleanup (Phase H)

Start after Phase G (E2-B) is stable and Hono deletion (Epoch 5) leaves no callers
depending on ALS-backed `Instance.*`.

1. Confine `InstanceState.bind(...)` usage to documented bridge files:
   `file/watcher.ts` (native callback), `session/llm.ts` (workflow approval callback).
2. Delete `Instance.current`, `Instance.directory`, `Instance.worktree`,
   `Instance.project`, `Instance.state`, `Instance.containsPath` from the public
   `Instance` object.
3. Remove the ALS fallback inside `src/effect/instance-state.ts` — `context` becomes
   pure `instance` from `InstanceRef`.
4. Delete or thin `src/project/instance.ts` to a compatibility shim with no public
   consumers.

Acceptance: `rg -l "Instance\.(current|directory|worktree|project|provide|bind|restore|reload|dispose|disposeAll|state)" src`
returns at most `file/watcher.ts` and `session/llm.ts`.

---

## Epoch 7 — v2 Features

These are independent and can be merged as focused PRs once Epoch 1 is stable.

### E7-A: TUI Command Shim Removal

Per `specs/v2/tui-command-shim.md`:

1. Remove from `packages/plugin/src/tui.ts`: `TuiCommand`, `TuiCommandApi`,
   `TuiPluginApi.command`.
2. Delete `src/cli/cmd/tui/plugin/command-shim.ts`.
3. Remove `createCommandShim` from `api.tsx` and `runtime.ts`.
4. Verify `bun run typecheck` in both `packages/plugin` and `packages/nikcli`.
5. Update any internal plugin that calls `api.command.register` → `api.keymap.registerLayer`.

### E7-B: Keymappings System Redesign

Per `specs/v2/keymappings.md`: rename the binding system from `keybindings` to
`keymappings`. Commands hold a stable `id`; key mappings reference that id:

```ts
{ key: "ctrl+w", cmd: string | (() => void), description: string }
```

Changes touch `packages/plugin/src/tui.ts` (types), `src/cli/cmd/tui/config/tui-schema.ts`
(config schema), and all internal plugins that register commands.

No `keybindings` → `keymappings` rename may break existing plugin config without a
migration helper in `tui-migrate.ts`.

### E7-C: Notifications Default Flip

Per `specs/v2/notifications.md`: change `attention.enabled` default from `false` to
`true` in the TUI config schema. Keep `false` as the explicit opt-out. Single-line
default change; verify with snapshot test.

### E7-D: Message Shape Decision

Per `specs/v2/message-shape.md`: choose **Option 2** (Prompt Mutators) unless session
replay requirements force Option 1 or 3. Reasoning: avoids a second full message type
and keeps ids/timestamps in the runtime, not the plugin.

Implement `PromptEditor` interface on `session/prompt.ts`'s prompt hook API:

```ts
type PromptEditor = {
  append(input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  prepend(input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  appendTo(target: "last-user" | "last-assistant", parts: PromptPart[]): void
  insertAfter(messageID: string, input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  insertBefore(messageID: string, input: { role: "user" | "assistant"; parts: PromptPart[] }): void
}
```

Effect Schema for `PromptPart` variants. Tests cover append/prepend round-trip.

---

## Epoch 8 — RuntimeFlags + Global Cleanup

### E8-A: Flag.ts Deletion (P2)

Sweep remaining `Flag.*` reads:
- Per callsite: route through `RuntimeFlags.Service`, accept as env/config boundary, or
  migrate to typed `Config`.
- Delete `test/fixture/flag.ts` once tests no longer mutate `Flag`.
- Delete `src/flag/flag.ts` once no packages import it.

### E8-B: Global Paths Explicit Init (P3)

`src/global/global.ts` mixes path calculation, import-time directory creation, `Flock`
setup, mutable `Path` state, and `Flag` dependency. Fix:

1. Replace mutable `Global.Path` test overrides with explicit test layers or scoped
   helpers. Use `Layer.succeed(GlobalPaths.Service, testPaths)`.
2. Move `Flock` setup and directory creation behind an explicit `GlobalPaths.Service.init`
   boundary called once at app startup.
3. Remove `Flag` dependency from global path resolution — paths are static after init.
4. `Global.make()` becomes an Effect-native service method.

---

## Epoch 9 — packages/server Extraction (Phase O)

Start after Epochs 5–7 are stable. `packages/server` must not be created while the HttpApi
contract and SDK byte-identity still churn.

Follow `specs/effect/server-package.md`:

1. Create `packages/server` (workspace, `package.json`, `tsconfig.json`, empty `src/`).
2. Extract `question` contract to `packages/server/src/definition/question.ts`.
3. Extract `question` handler factory to `packages/server/src/api/question.ts`.
4. Mount from `packages/nikcli` via `bridge/hono.ts`.
5. Merge legacy + contract OpenAPI into one document; add merged-spec test.
6. `GET /provider/auth` slice.
7. `GET /config/providers` slice.
8. Read-only instance routes (`/path`, `/vcs`, `/command`, `/agent`, `/skill`).
9. After `packages/core` exists: move host ownership.
10. After server + core stable: split `packages/cli`.

---

## v2 API Surface (specs/v2/api.ts)

The public `OpenCode.make({})` / `nikcli.session.*` / `nikcli.tool.add(...)` API exposed
by `@nikcli-ai/core` is the long-term public SDK surface. Wire it after the internal
HttpApi migration is stable:

- `nikcli.tool.add(def)` — registers a tool via `ToolRegistry.Service`.
- `nikcli.agent.add(def)` — registers an agent via `Agent.Service`.
- `nikcli.auth.add(entry)` — registers provider credentials via `ProviderAuth.Service`.
- `nikcli.session.create(input)` → `Session.Service.create`.
- `nikcli.session.prompt(input)` → `SessionPrompt.Service.prompt` (streaming).
- `nikcli.session.wait()` → drain the running prompt fiber.
- `nikcli.session.messages(sessionID)` → `Session.Service.messages`.
- `nikcli.subscribe(handler)` → `Bus.Service.subscribeAll`.

This is a thin orchestration layer, not a re-implementation of services. Each method is
one `AppRuntime.runPromise(Effect.gen(...))` call. No separate runtime.

---

## TUI Plugin System — Remaining Work

Per `specs/tui-plugins.md`, the current system is documented but two gaps remain:

1. **`api.command` → `api.keymap` migration** — covered by E7-A + E7-B.
2. **Plugin version compatibility enforcement** — `engines.nikcli` semver check is
   specced but verify it is implemented in `src/plugin/install.ts` `readPluginManifest`.
   If not, add it as a small validator that runs before `patchPluginConfig`.
3. **Plugin cleanup budget** — 5-second timeout per plugin on dispose. Verify the timeout
   is wired in `tui/plugin/runtime.ts`; if not, wrap the `onDispose` chain with
   `Effect.timeout(Duration.seconds(5))` and log on expiry.

---

## Validation Gates Per Epoch

| Epoch | Gate |
|-------|------|
| E1-A | `rg "NamedError.create" src` → session wire helpers only |
| E1-B | `rg "NamedError.Unknown" src` → 0 matches |
| E1-C | SDK byte-identity after each file; `bun run typecheck` |
| E2-A | `bun test test/sync/... test/workspace/...` |
| E2-B | `bun test test/project/instance-cache.test.ts`; concurrent dispose test |
| E2-C | `bun test test/server/httpapi-*.test.ts`; middleware LOC decreases |
| E3-A | `bun test test/server/httpapi-session.test.ts` covers all new routes |
| E3-B | `bun test test/server/httpapi-sync.test.ts` |
| E3-C | SSE stream test; no Hono `streamSSE` import in Effect backend |
| E3-D | PTY WebSocket integration test using Bun WS client |
| E3-E | TUI control routes integration test |
| E4-A | `bun packages/sdk/js/script/build.ts --diff` → 0 unexpected lines |
| E4-B | Each PR: OpenAPI drift test + typecheck + SDK diff |
| E4-C | `bun packages/sdk/js/script/build.ts` → identical to pre-flip baseline or documented diff |
| E5 | Per group: SDK diff 0; `rg "from \"hono\"" src/server` shrinks after each deletion |
| E6 | `rg -l "Instance\.(current|directory|worktree|project|provide)" src` → documented bridge files only |
| E7-A | `bun run typecheck` in packages/plugin + packages/nikcli |
| E7-B | Plugin config migration test; existing keybind tests pass |
| E7-C | Config schema snapshot test |
| E7-D | Prompt hook test covering append/prepend/insertAfter |
| E8-A | `rg "from.*flag.ts" packages/*/src` → 0 matches |
| E8-B | No import-time directory creation outside `GlobalPaths.Service.init` |
| E9 | `bun test` in packages/server; `packages/nikcli` still passes |

---

## Cross-Cutting Rules (non-negotiable)

1. **Bun everywhere.** `@effect/platform-bun` for all runtime I/O. `Bun.spawn` for
   child processes in service internals. `BunFileSystem` via `AppFileSystem.Service`.
   No `child_process`, no `fs/promises` outside legacy bridge files.
2. **Effect.fn tracing on all service methods.** `Effect.fn("Service.method")`.
3. **No parallel schema sources.** Effect Schema owns the type; `.zod` is derived by
   `@/util/effect-zod`. Never maintain a hand-written Zod schema alongside an Effect
   Schema for the same type.
4. **SDK byte-identity.** Any PR that touches a domain schema runs
   `bun packages/sdk/js/script/build.ts` and reviews the diff before merging.
5. **No partial conversions committed.** A file is either fully on the target shape or
   the checklist item is not checked off.
6. **No instance-context shortcuts.** Effect code reads instance through
   `InstanceState.context` / `yield* InstanceState.directory`. Legacy `Instance.*` ALS
   reads only at documented bridge files.
7. **Compile after every change.** `bun run typecheck` is the cheapest gate.

---

## Definition of Done

The integration is complete when:

1. `rg -l "Instance\.(current|directory|worktree|project|provide|bind|restore|reload|dispose|disposeAll|state)" src`
   returns at most `file/watcher.ts` and `session/llm.ts`.
2. `rg -l "from \"hono\"|hono-openapi|streamSSE" src/server` returns 0 files.
3. `bun run typecheck` and `bun test` pass (full suite).
4. `bun packages/sdk/js/script/build.ts` produces output identical to pre-flip baseline
   or a documented intentional diff.
5. No file imports `effect/Effect` and also exports an `async function` facade for the
   same surface.
6. `packages/server` exists, owns its HttpApi contracts, and `packages/nikcli` consumes
   it without cycles.
7. TUI plugin API exposes `api.keymap` only — `api.command` shim is deleted.
8. `Flag.ts` is deleted from the workspace.
9. `Global.Path` mutation is replaced with an explicit `GlobalPaths.Service.init` boundary.
