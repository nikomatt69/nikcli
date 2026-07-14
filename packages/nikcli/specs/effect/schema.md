# Schema migration

Practical reference for migrating data types in `packages/nikcli` from
Zod-first definitions to Effect Schema with Zod compatibility shims.

## Goal

Use Effect Schema as the source of truth for domain models, IDs, inputs,
outputs, and typed errors. Keep Zod available at existing HTTP, tool, and
compatibility boundaries by exposing a `.zod` static derived from the Effect
schema via `@/util/effect-zod`.

The long-term driver is `specs/effect/http-api.md` — once the HTTP server
moves to `@effect/platform`, every Schema-first DTO can flow through
`HttpApi` / `HttpRouter` without a zod translation layer, and the entire
`effect-zod` walker plus every `.zod` static can be deleted.

## Preferred shapes

### Data objects

Use `Schema.Class` for structured data.

```ts
export class Info extends Schema.Class<Info>("Foo.Info")({
  id: FooID,
  name: Schema.String,
  enabled: Schema.Boolean,
}) {
  static readonly zod = zod(Info)
}
```

If the class cannot reference itself cleanly during initialization, use the
two-step `withStatics` pattern:

```ts
export const Info = Schema.Struct({
  id: FooID,
  name: Schema.String,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
```

### Errors

Use `Schema.TaggedErrorClass` for domain errors.

```ts
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FooNotFoundError", {
  id: FooID,
}) {}
```

### IDs and branded leaf types

Keep branded/schema-backed IDs as Effect schemas and expose
`static readonly zod` for compatibility when callers still expect Zod.

### Refinements

Reuse named refinements instead of re-spelling `z.number().int().positive()`
in every schema. The `effect-zod` walker translates the Effect versions into
the corresponding zod methods, so JSON Schema output (`type: integer`,
`exclusiveMinimum`, `pattern`, `format: uuid`, …) is preserved.

```ts
const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
```

See `test/util/effect-zod.test.ts` for the full set of translated checks.

## Compatibility rule

During migration, route validators, tool parameters, and any existing
Zod-based boundary should consume the derived `.zod` schema instead of
maintaining a second hand-written Zod schema.

The default should be:

- Effect Schema owns the type
- `.zod` exists only as a compatibility surface
- new domain models should not start Zod-first unless there is a concrete
  boundary-specific need

## When Zod can stay

It is fine to keep a Zod-native schema temporarily when:

- the type is only used at an HTTP or tool boundary and is not reused elsewhere
- the validator depends on Zod-only transforms or behavior not yet covered by `zod()`
- the migration would force unrelated churn across a large call graph

When this happens, prefer leaving a short note or TODO rather than silently
creating a parallel schema source of truth.

## Escape hatches

The walker in `@/util/effect-zod` exposes explicit escape hatches and opt-in
annotations for cases the pure-Schema path cannot express. Each one stays in the codebase
only as long as its upstream or local dependency requires it — inline
comments document when each can be deleted.

### `ZodOverride` annotation

Replaces the entire derivation with a hand-crafted zod schema. Used when:

- the target carries external `$ref` metadata (e.g.
  `config/model-id.ts` points at `https://models.dev/...`)
- the target is a zod-only schema that cannot yet be expressed as Schema
  (e.g. `ConfigAgent.Info`, `Log.Level`)

### `discriminator` annotation on unions

`Schema.Union([...]).annotate({ discriminator: "<key>" })` makes the walker
emit `z.discriminatedUnion("<key>", [...])` instead of a flat `z.union([...])`,
**when every variant is a struct carrying `<key>` as a single-value
`Schema.Literal` with values unique across variants**. If the variants don't
qualify the walker falls back to `z.union` (never throws).

Why it matters: a flat union of N tagged structs validates by trying every arm
and, on failure, aggregates an `invalid_union` issue containing all N arms'
errors — unusable for both error messages and any LLM emitting the value. The
discriminated form restores O(1) tag dispatch and yields a single targeted
issue at the real field (e.g. `body[0].options: expected array`). This directly
reduces tool-call failures for large tagged unions (`src/interaction/spec.ts`,
and applicable to `src/tool/opentui.ts`). It is opt-in, so existing schemas are
unaffected unless annotated. Covered by `test/util/effect-zod.test.ts`.

### Local `DeepMutable<T>` in `config/config.ts`

`Schema.Struct` produces `readonly` types. Some consumer code (notably the
`Config` service) mutates `Info` objects directly, so a readonly-stripping
utility is needed when casting the derived zod schema's output type.

`Types.DeepMutable` from effect-smol would be a drop-in, but it widens
`unknown` to `{}` in the fallback branch — a bug that affects any schema
using `Schema.Record(String, Schema.Unknown)`.

Tracked upstream as `effect:core/x228my`: "Types.DeepMutable widens unknown
to `{}`." Once that lands, the local `DeepMutable` copy can be deleted and
`Types.DeepMutable` used directly.

## Ordering

Migrate in this order:

1. Shared leaf models and `schema.ts` files
2. Exported `Info`, `Input`, `Output`, and DTO types
3. Tagged domain errors
4. Service-local internal models
5. Route and tool boundary validators that can switch to `.zod`

This keeps shared types canonical first and makes boundary updates mostly
mechanical.

## Progress tracker

2026-07-08: new HttpApi slices `httpapi/analytics.ts`, `httpapi/global.ts`, and
`httpapi/mission.ts` author their route DTOs as Effect Schema
(`Schema.Struct` for typed bodies, `Schema.Unknown` where the legacy Hono
contract was `z.any()`). Mission create/update bodies intentionally keep the
zod `MissionDefinitionSchema` as parse source (via `safeParse` inside the
handler) because the legacy validator applied zod defaults; that zod stays the
single source of truth per the "When Zod can stay" rule and flips together
with `mission/schema.ts` if it ever migrates.

### `src/config/` ✅ complete

All of `packages/nikcli/src/config/` has been migrated. Files that still
import `z` do so only for local `ZodOverride` bridges or for `z.ZodType`
type annotations — the `export const <Info|Spec>` values are all Effect
Schema at source.

A file is considered "done" when:

- its exported schema values (`Info`, `Input`, `Event`, `Definition`, etc.)
  are authored as Effect Schema
- any remaining zod is either a derived compat bridge (via `zod()` /
  `zodObject()`), a `z.ZodType` type annotation, or a documented
  `ZodOverride` escape hatch — never a hand-written parallel source of truth

Files that meet this bar but still carry a compat bridge are checked off
with an inline note describing the bridge and what unblocks its removal.

- [ ] skills, formatter, console-state, mcp, lsp, permission (leaves), model-id, command, plugin, provider
- [ ] server, layout
- [ ] keybinds
- [ ] permission#Info
- [ ] agent
- [ ] config.ts root

### `src/*/schema.ts` leaf modules

Current branch audit, 2026-05-07: of the 12 files originally listed, only 3 exist on this branch. The rest live inline inside the owning namespace file (e.g. `Pty.Info` lives in `src/pty/index.ts`, not in a `pty/schema.ts` leaf). Those are tracked under Phase P (large surfaces) instead.

- [x] `src/account/schema.ts` - intentionally left as Zod-first. Reason: no Effect-side consumer on this branch (`rg -l "account/schema|Account\\.Info" src/server/httpapi src/effect` returns no matches). Migrating would add walker indirection without a downstream benefit; revisit when an HttpApi route group needs `Account.Info` as Effect Schema.
- [x] `src/permission/schema.ts` - migrated. Effect Schema is the source of truth (`ActionSchema`, `RuleSchema`, `RulesetSchema`); public `Action`, `Rule`, `Ruleset` are derived via `zod(...)` from `@/util/effect-zod`. Tests (`bun test test/permission/schema.test.ts`) pass without changes.
  - 2026-07-07: the ruleset model + pure evaluator that lived inline in `permission/next.ts` moved to `src/permission/ruleset.ts` (`PermissionRuleset`), so light clients (`tool/truncation.ts`, the TUI) evaluate rules without pulling the stateful service and its drizzle-backed repo. `PermissionNext` re-exports the same names, so the public API is unchanged. TODO: consolidate `permission/schema.ts` and `permission/ruleset.ts` into one definition (they are parallel copies; `ruleset.ts` preserves the original `next.ts` literal order and mutable Ruleset used by `agent/agent.ts`).
- [x] `src/storage/schema.ts` - intentionally left as-is. Reason: file only re-exports drizzle SQL table definitions (`users`, `userSessions`, `chatContacts`, `chatMessages`, `account`, `config`, `workspace`, `mobileTokens`); no validation schemas here.
- [x] `src/control-plane/schema.ts` - file does not exist on this branch.
- [x] `src/project/schema.ts` - file does not exist on this branch.
- [x] `src/provider/schema.ts` - file does not exist on this branch.
- [x] `src/pty/schema.ts` - file does not exist on this branch.
- [x] `src/question/schema.ts` - file does not exist on this branch.
- [x] `src/session/schema.ts` - file does not exist on this branch.
- [x] `src/sync/schema.ts` - file does not exist on this branch.
- [x] `src/tool/schema.ts` - file does not exist on this branch.
- [x] `src/util/schema.ts` - file does not exist on this branch.

### Session domain

Major cluster. Message + event types flow through the SSE API and every SDK
output, so byte-identical SDK surface is critical.

Suggested order for this cluster, starting from the leaves that `session.ts`
and the SSE/event surface depend on:

1. `src/session/schema.ts` ✅ already migrated
2. `src/provider/schema.ts` if `message-v2.ts` still relies on zod-first IDs
3. `src/lsp/*` schema leaves needed by `LSP.Range`
4. `src/snapshot/*` leaves used by `Snapshot.FileDiff`
5. `src/session/message-v2.ts`
6. `src/session/message.ts`
7. `src/session/prompt.ts`
8. `src/session/revert.ts`
9. `src/session/summary.ts`
10. `src/session/status.ts`
11. `src/session/todo.ts`
12. `src/session/session.ts`
13. `src/session/compaction.ts`

Dependency sketch:

```text
session.ts
|- project/schema.ts
|- control-plane/schema.ts
|- permission/schema.ts
|- snapshot/*
|- message-v2.ts
|  |- provider/schema.ts
|  |- lsp/*
|  |- snapshot/*
|  |- sync/index.ts
|  `- bus/bus-event.ts
|- sync/index.ts
|- bus/bus-event.ts
`- util/update-schema.ts
```

Working rule for this cluster:

- migrate reusable leaf schemas and nested payload objects first
- migrate aggregate DTOs like `Session.Info` after their nested pieces exist as
  named Schema values
- leave zod-only event/update helpers in place temporarily when converting
  them would force unrelated churn across sync/bus boundaries

`message-v2.ts` first-pass outline:

1. Schema-backed imports already available
   - `SessionID`, `MessageID`, `PartID`
   - `ProviderID`, `ModelID`
2. Local leaf objects to extract and migrate first
   - output format payloads
   - common part bases like `PartBase`
   - timestamp/range helper objects like `time.start/end`
   - file/source helper objects
   - token/cost/model helper objects
3. Part variants built from those leaves
   - `SnapshotPart`, `PatchPart`, `TextPart`, `ReasoningPart`
   - `FilePart`, `AgentPart`, `CompactionPart`, `SubtaskPart`
   - retry/step/tool related parts
4. Higher-level unions and DTOs
   - `FilePartSource`
   - part unions
   - message unions and assistant/user payloads
5. Errors and event payloads last
   - `NamedError.create(...)` shapes can stay temporarily if converting them to
     `Schema.TaggedErrorClass` would force unrelated churn
   - `SyncEvent.define(...)` and `BusEvent.define(...)` payloads can use
     derived `.zod` at remaining zod-based HTTP/OpenAPI boundaries

Possible later tightening after the Schema-first migration is stable:

- promote repeated opaque strings and timestamp numbers into branded/newtype
  leaf schemas where that adds domain value without changing the wire format

- [ ] `src/session/compaction.ts`
- [ ] `src/session/message-v2.ts`
- [ ] `src/session/message.ts`
- [ ] `src/session/prompt.ts`
- [ ] `src/session/revert.ts`
- [ ] `src/session/session.ts`
- [ ] `src/session/status.ts`
- [ ] `src/session/summary.ts`
- [ ] `src/session/todo.ts`

### Provider domain

- [x] `src/provider/auth.ts` — `ProviderAuth.Method`, `Authorization`, and authorize/callback/api input contracts are now Effect Schema-first with Zod derived via `zodObject(...)`. Evidence: `bun run typecheck`, `bun test test/provider/auth-effect-service.test.ts test/server/httpapi-provider.test.ts`, and `bun test test/provider/core.test.ts -t "ProviderAuth contracts"`.
- [ ] `src/provider/models.ts`
- [ ] `src/provider/provider.ts`

#### `@nikcli-ai/llm` route routing (2026-05-13)

- [x] `Provider.Service.getModelRef` resolves each `Provider.Model` to a `ModelRef` via `@nikcli-ai/llm/providers` (`OpenAI.responses`, `Anthropic.model`, `Azure.model`, `XAI.responses`, `OpenRouter.model`, `GitHubCopilot.model`, `OpenAICompatible.profileModel/model`, etc.). Implemented in `mapToModelRef()` in `src/provider/provider.ts`.
- [x] `@nikcli-ai/llm` now ships a Promise/AsyncIterable runtime (`@nikcli-ai/llm/runtime`) that provisions `LLMClient.layer` with `RequestExecutor.defaultLayer` internally. This bridges the effect@3.21 ↔ effect@4.x gap between nikcli and the LLM package without coupling types across runtimes.
- [x] `src/session/llm.ts` calls `Runtime.prepareRequest(llmRequest)` on every stream — this compiles the request through the registered route's `body.from` + `transport.prepare`, exercising `@nikcli-ai/llm`'s provider routing end-to-end (everything short of the actual HTTP dispatch).
- [ ] HTTP dispatch: still flows through AI SDK (`LLMCore.stream` = `streamText`). Migrating requires either an `LLMEvent` → AI-SDK `fullStream` adapter, or rewriting `src/session/processor.ts` to consume `LLMEvent` directly. See `packages/llm/src/runtime.ts` `streamRequest()` for the available entry point.

### Tool schemas

Each tool declares its parameters via a zod schema. Tools are consumed by
both the in-process runtime and the AI SDK's tool-calling layer, so the
emitted JSON Schema must stay byte-identical. Internal source of truth is
Effect Schema; public `parameters: z.ZodType` is derived via `zod()`.

Migrated to Effect Schema → `zod()` (Phase J, 2026-05-07):

- [x] `src/tool/invalid.ts`
- [x] `src/tool/multiedit.ts`
- [x] `src/tool/todo.ts` — both `TodoReadTool` and `TodoWriteTool` migrated. `Todo.Info` migrated to Effect Schema (Phase P starter), `TodoWriteTool.parameters` declares the same field shape as a dedicated Schema.Struct to keep tool params self-contained.
- [x] `src/tool/websearch.ts`
- [x] `src/tool/glob.ts`
- [x] `src/tool/write.ts`
- [x] `src/tool/grep.ts`
- [x] `src/tool/lsp.ts`
- [x] `src/tool/plan.ts`
- [x] `src/tool/skill.ts`
- [x] `src/tool/webfetch.ts`
- [x] `src/tool/ls.ts`
- [x] `src/tool/codesearch.ts`
- [x] `src/tool/search_tools.ts`
- [x] `src/tool/exec_code.ts`
- [x] `src/tool/edit.ts`
- [x] `src/tool/bash.ts`
- [x] `src/tool/batch.ts`
- [x] `src/tool/speak.ts`

Intentionally Zod-pinned (with rationale):

- [x] `src/tool/read.ts` — migrated. Walker now maps `Schema.NumberFromString` → `z.coerce.number()` so `offset` and `limit` accept either string (HTTP query) or number (AI SDK tool call) and decode to number.
- [x] `src/tool/opentui.ts` — migrated. `z.discriminatedUnion("type", [...])` mapped to `Schema.Union(...)` of tagged structs (`Schema.Literal("bar_chart")` etc.). Functionally equivalent JSON Schema (oneOf with const discriminator); runtime parsing falls back from O(1) tag dispatch to O(n) try-each, but this tool is invoked once per dialog so the cost is irrelevant.
- [x] `src/tool/question.ts` — migrated. Uses a dedicated `QuestionWithoutCustom` Schema.Struct instead of `Question.Info.omit({custom:true})` because the walker doesn't introspect Zod's `.omit`. Functionally equivalent: same fields, same JSON Schema; the omitted-custom variant is what the AI SDK sees.
- [x] `src/tool/registry.ts` — `Tool.Def.parameters: z.ZodType` is the canonical public type; plugin-provided tools also pass Zod via `def.args` (`@nikcli-ai/plugin` SDK is Zod-first). Keeping Zod is intentional.
- [x] `src/tool/apply_patch.ts` / `src/tool/task.ts` — already on canonical shape per migration sweep; verify on a follow-up pass.
- [x] `src/tool/tool.ts` — `Tool.define` core; receives Zod from authored tools, no schema migration needed.

Walker enhancements landed during Phase J:

- `effect/SchemaId/MinItems` and `effect/SchemaId/MaxItems` for `Schema.Array(...).pipe(Schema.minItems(n), Schema.maxItems(n))`.

### HTTP route boundaries

Every file in `src/server/routes/` uses hono-openapi with zod validators for
route inputs/outputs. Migrating these individually is the last step; most
will switch to `.zod` derived from the Schema-migrated domain types above,
which means touching them is largely mechanical once the domain side is
done.

- [ ] `src/server/error.ts`
- [ ] `src/server/event.ts`
- [ ] `src/server/projectors.ts`
- [ ] `src/server/routes/control/index.ts`
- [ ] `src/server/routes/control/workspace.ts`
- [ ] `src/server/routes/global.ts`
- [ ] `src/server/routes/instance/index.ts`
- [ ] `src/server/routes/instance/config.ts`
- [ ] `src/server/routes/instance/event.ts`
- [ ] `src/server/routes/instance/experimental.ts`
- [ ] `src/server/routes/instance/file.ts`
- [ ] `src/server/routes/instance/mcp.ts`
- [ ] `src/server/routes/instance/permission.ts`
- [ ] `src/server/routes/instance/project.ts`
- [ ] `src/server/routes/instance/provider.ts`
- [ ] `src/server/routes/instance/pty.ts`
- [ ] `src/server/routes/instance/question.ts`
- [ ] `src/server/routes/instance/session.ts`
- [ ] `src/server/routes/instance/sync.ts`
- [ ] `src/server/routes/instance/tui.ts`

The bigger prize for this group is the `@effect/platform` HTTP migration
described in `specs/effect/http-api.md`. Once that lands, every one of
these files changes shape entirely (`HttpApi.endpoint(...)` and friends),
so the Schema-first domain types become a prerequisite rather than a
sibling task.

### Everything else

Small / shared / control-plane / CLI. Mostly independent; can be done
piecewise.

- [ ] `src/acp/agent.ts`
- [ ] `src/agent/agent.ts`
- [ ] `src/bus/bus-event.ts`
- [ ] `src/bus/index.ts`
- [ ] `src/cli/cmd/tui/config/tui-migrate.ts`
- [ ] `src/cli/cmd/tui/config/tui-schema.ts`
- [ ] `src/cli/cmd/tui/config/tui.ts`
- [ ] `src/cli/cmd/tui/event.ts`
- [ ] `src/cli/ui.ts`
- [ ] `src/command/index.ts`
- [ ] `src/control-plane/adapters/worktree.ts`
- [ ] `src/control-plane/types.ts`
- [ ] `src/control-plane/workspace.ts`
- [ ] `src/file/index.ts`
- [ ] `src/file/ripgrep.ts`
- [ ] `src/file/watcher.ts`
- [ ] `src/format/index.ts`
- [ ] `src/id/id.ts`
- [ ] `src/ide/index.ts`
- [ ] `src/installation/index.ts`
- [ ] `src/lsp/client.ts`
- [ ] `src/lsp/lsp.ts`
- [ ] `src/mcp/auth.ts`
- [ ] `src/patch/index.ts`
- [ ] `src/plugin/github-copilot/models.ts`
- [ ] `src/project/project.ts`
- [ ] `src/project/vcs.ts`
- [ ] `src/pty/index.ts`
- [ ] `src/skill/index.ts`
- [ ] `src/snapshot/index.ts`
- [ ] `src/storage/db.ts`
- [ ] `src/storage/storage.ts`
- [ ] `src/sync/index.ts` — public API (`SyncEvent.define`) is Schema-first; `payloads()` still derives zod for the remaining HTTP/OpenAPI boundary
- [ ] `src/util/fn.ts`
- [ ] `src/util/log.ts`
- [ ] `src/util/update-schema.ts`
- [ ] `src/worktree/index.ts`

### Do-not-migrate

- `src/util/effect-zod.ts` — the walker itself. Stays zod-importing forever
  (it's what emits zod from Schema). Goes away only when the `.zod`
  compatibility layer is no longer needed anywhere.

## Notes

- **2026-07-14 — SDK-flip blocker is now schema-shaped**: the Effect `PublicApi`
  contract reached full endpoint/operationId parity with Hono (see
  `specs/effect/http-api.md`, "full contract parity reached"). The only thing
  keeping SDK generation on Hono is that the contract types domain objects as
  `Schema.Unknown` where their canonical definition is still zod: the
  hey-api SDK generated from the Effect spec then lacks the named types
  `Event` (Bus event union), `Message`, `UserMessage`, `Part`, `Todo`,
  `Model`, and `SessionStatus` that `@nikcli-ai/plugin` re-exports. Migrating
  `session/message-v2.ts`, the Bus event payloads, and `SessionStatus` to
  Effect Schema closes the flip.

- **Walker now available**: `src/util/effect-zod.ts` ships the Effect Schema → Zod walker. Exports: `zod(schema)`, `zodObject(schema)`, `withStatics(...)`, `zodOverride(fn)`, `ZodOverrideId`, `DeepMutable<T>`. Coverage: structs, arrays, unions, literals, records, NullOr, optional, primitives, the canonical refinements (`isInt`, `isGreaterThan*`, `isLessThan*`, `isPattern`, `isUUID`, `isMinLength`, `isMaxLength`), Suspend/lazy, Declaration surrogates, Enums, and opt-in discriminated unions (`.annotate({ discriminator: "<key>" })` → `z.discriminatedUnion`). Validated by `bun test test/util/effect-zod.test.ts` (28 tests). Constructs not yet supported fall back to `z.unknown()`; extend the walker switch when a new construct first appears in `src/`.
- Use `@/util/effect-zod` for all Schema → Zod conversion.
- Prefer one canonical schema definition. Avoid maintaining parallel Zod and
  Effect definitions for the same domain type.
- Keep the migration incremental. Converting the domain model first is more
  valuable than converting every boundary in the same change.
- Every migrated file should leave the generated SDK output (`packages/sdk/
openapi.json` and `packages/sdk/js/src/v2/gen/types.gen.ts`) byte-identical
  unless the change is deliberately user-visible.
- Session v2 (`src/session/v2/`) stays zod-first for now: its schemas
  (`SessionEntry`, `SessionEvent`) feed `hono-openapi` resolvers directly
  (`GET /session/:id/v2/{entries,state}`). Migrate them to Effect Schema +
  the walker together with `session/message-v2.ts`, not before — the v2
  parts embed `MessageV2.FilePart`/`APIError` and must convert in lockstep.
  Status of the v2 read model itself: specs/v2/message-shape.md.
