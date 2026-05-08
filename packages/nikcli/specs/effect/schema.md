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

The walker in `@/util/effect-zod` exposes two explicit escape hatches for
cases the pure-Schema path cannot express. Each one stays in the codebase
only as long as its upstream or local dependency requires it — inline
comments document when each can be deleted.

### `ZodOverride` annotation

Replaces the entire derivation with a hand-crafted zod schema. Used when:

- the target carries external `$ref` metadata (e.g.
  `config/model-id.ts` points at `https://models.dev/...`)
- the target is a zod-only schema that cannot yet be expressed as Schema
  (e.g. `ConfigAgent.Info`, `Log.Level`)

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

### `src/config/`

Current branch audit, 2026-05-08: this section is not complete yet. Several
`packages/nikcli/src/config/` exports are still Zod-first because they are
part of the user config JSON Schema surface (`Config.Info`,
`Config.Mcp`, `Config.Connector`, `Config.Command`, `Config.TUI`,
`Config.Provider`, `Config.Permission`, `Config.Keybinds`, etc.). Keep these
open until each exported config contract is authored as Effect Schema and
the JSON Schema output is proven byte-identical.

A file is considered "done" when:

- its exported schema values (`Info`, `Input`, `Event`, `Definition`, etc.)
  are authored as Effect Schema
- any remaining zod is either a derived compat bridge (via `zod()` /
  `zodObject()`), a `z.ZodType` type annotation, or a documented
  `ZodOverride` escape hatch — never a hand-written parallel source of truth

Files that meet this bar but still carry a compat bridge are checked off
with an inline note describing the bridge and what unblocks its removal.

- [ ] `src/config/config.ts` root `Config.Info` and nested config contracts
      (`Mcp`, `Connector`, `Permission`, `Command`, `Agent`, `Keybinds`, `TUI`,
      `Server`, `Layout`, `Provider`, formatter/lsp blocks, plugin spec).
- [ ] `src/config/tui-schema.ts` — `TuiOptions`, `TuiInfo`, and keybind
      override helper are Zod-first derivatives of config shapes.
      Blocked on `Config.Keybinds.shape` (requires `Config.Info` migration first).
- [x] `src/config/paths.ts` — `JsonError` and `InvalidError` migrated.
      `JsonErrorSchema` / `InvalidErrorSchema` are Effect Schema; `zodObject()` derives
      the Zod payload for `NamedError.create`. `ZodOverride` escape hatch on
      `ZodIssuesSchema` for `z.core.$ZodIssue[]` (Zod-only type, no Effect equivalent).
      Unblocks when `$ZodIssue` gets a native Schema representation.
- [x] `src/config/markdown.ts` — `FrontmatterError` migrated.
      `FrontmatterErrorSchema` is Effect Schema; `zodObject()` derives Zod payload.
      No parallel Zod source.
- [x] `src/config/migrate-tui-config.ts` — no schema definitions found.
- [x] `src/config/tui.ts` — no schema definitions found.

### `src/*/schema.ts` leaf modules

Current branch audit, 2026-05-07: of the 12 files originally listed, only 3 exist on this branch. The rest live inline inside the owning namespace file (e.g. `Pty.Info` lives in `src/pty/index.ts`, not in a `pty/schema.ts` leaf). Those are tracked under Phase P (large surfaces) instead.

- [x] `src/account/schema.ts` - intentionally left as Zod-first. Reason: no Effect-side consumer on this branch (`rg -l "account/schema|Account\\.Info" src/server/httpapi src/effect` returns no matches). Migrating would add walker indirection without a downstream benefit; revisit when an HttpApi route group needs `Account.Info` as Effect Schema.
- [x] `src/permission/schema.ts` - migrated. Effect Schema is the source of truth (`ActionSchema`, `RuleSchema`, `RulesetSchema`); public `Action`, `Rule`, `Ruleset` are derived via `zod(...)` from `@/util/effect-zod`. Tests (`bun test test/permission/schema.test.ts`) pass without changes.
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

- [x] `src/session/compaction.ts` — `CreateInput` migrated.
- [ ] `src/session/message-v2.ts` — blocked on walker nested-struct shape inference (LSP.Range and other extended structs widen to `unknown` through `.extend(...)`).
- [ ] `src/session/message.ts`
- [ ] `src/session/prompt.ts`
- [x] `src/session/revert.ts` — `RevertInput` migrated.
- [ ] `src/session/session.ts` — large; coordinates with Phase D2 session route effectification.
- [ ] `src/session/v2/entry.ts` — Zod-first experimental/v2 entry and part unions.
- [ ] `src/session/v2/event.ts` — Zod-first v2 event/source payloads.
- [ ] `src/session/v2/index.ts` — Zod-first v2 create/prompt inputs.
- [x] `src/session/status.ts` — `Info` Schema.Union of tagged structs with `zodObjectMode("strip")` to preserve forward-compatible payload tolerance.
- [x] `src/session/summary.ts` — `SummarizeInput`, `DiffInput` migrated.
- [x] `src/session/todo.ts` — `Todo.Info` migrated.

### Provider domain

- [x] `src/provider/auth.ts` — `ProviderAuth.Method`, `Authorization`, and authorize/callback/api input contracts are now Effect Schema-first with Zod derived via `zodObject(...)`. `OauthMissing` / `OauthCodeMissing` / `OauthCallbackFailed` payloads migrated to `zodObject(Schema.Struct(...))`; shared `ProviderIDPayload` extracted. Zod import removed. Evidence: `bun run typecheck`, `bun test test/provider/auth-effect-service.test.ts test/server/httpapi-provider.test.ts`, and `bun test test/provider/core.test.ts -t "ProviderAuth contracts"`.
- [x] `src/provider/models.ts` — `ModelsDev.Model` and `ModelsDev.Provider` migrated, both `DeepMutable<...>`. Shared `ModalityValueSchema` and `CostBlockSchema` extracted. Zod import removed.
- [x] `src/provider/provider.ts` — `Provider.Model` and `Provider.Info` migrated. Both `DeepMutable<...>`. Shared `CapabilitiesIOSchema` / `CostBlockSchema` extracted; internal fetch wrapper / spread sites use single-property casts to satisfy readonly-on-paper Schema.Struct outputs without changing runtime behavior.

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

Current branch audit, 2026-05-08: the historical `routes/instance/*` and
`routes/control/*` paths do not exist on this branch. The active legacy Hono
surface is flat under `src/server/routes/`, plus some top-level handlers in
`src/server/server.ts`.

- [ ] `src/server/error.ts` — error response resolver uses Effect Schema
      (`BadRequestErrorSchema` via `zodObject` with `zodObjectMode("strip")`) for
      the 400 payload. `Storage.NotFoundError.Schema` is the compat Zod derived
      from Effect Schema. Remaining: the `resolver()` call from `hono-openapi`
      still requires a Zod object, which `zodObject` provides.
- [x] `src/server/event.ts` — `Event.Connected` and `Event.Disposed` use
      `Schema.Struct({})` with `zodObjectMode("strip")`. No Zod-first schemas remain.
- [x] `src/server/projectors.ts` — file does not exist on this branch.
- [ ] `src/server/server.ts` — top-level/share/instance handlers still carry
      inline Zod validators.
- [ ] `src/server/routes/config.ts`
- [ ] `src/server/routes/connectors.ts`
- [ ] `src/server/routes/experimental.ts`
- [ ] `src/server/routes/file.ts`
- [ ] `src/server/routes/global.ts`
- [ ] `src/server/routes/mcp.ts`
- [ ] `src/server/routes/mobile.ts`
- [ ] `src/server/routes/permission.ts`
- [ ] `src/server/routes/project.ts`
- [ ] `src/server/routes/provider.ts`
- [ ] `src/server/routes/pty.ts`
- [ ] `src/server/routes/question.ts`
- [ ] `src/server/routes/session.ts`
- [ ] `src/server/routes/tui.ts`
- [x] `src/server/routes/chatbot.ts` — no Zod schema definitions found in
      current audit.
- [x] `src/server/routes/companion.ts` — no Zod schema definitions found in
      current audit.
- [x] `src/server/routes/users.ts` — no Zod schema definitions found in
      current audit.
- [x] `src/server/routes/workspace.ts` — no Zod schema definitions found in
      current audit.
- [x] `src/server/routes/control/index.ts` — file does not exist on this
      branch.
- [x] `src/server/routes/control/workspace.ts` — file does not exist on this
      branch.
- [x] `src/server/routes/instance/*` — historical route tree does not exist
      on this branch; active routes are the flat files listed above.

The bigger prize for this group is the `@effect/platform` HTTP migration
described in `specs/effect/http-api.md`. Once that lands, every one of
these files changes shape entirely (`HttpApi.endpoint(...)` and friends),
so the Schema-first domain types become a prerequisite rather than a
sibling task.

### Everything else

Small / shared / control-plane / CLI. Mostly independent; can be done
piecewise.

- [x] `src/acp/agent.ts`
  - Uses migrated `Todo.Info` for parsing; remaining Zod use is local
    compatibility parsing, not an exported schema.
- [x] `src/agent/agent.ts` — `Agent.Info` migrated as `Schema.mutable(Schema.Struct(...))` because the agent record is mutated extensively in config merge logic. Reuses `PermissionNext.RuleSchema`. The inline `generateObject({schema: ...})` call site uses `zodObject(Schema.Struct({...}))`. Zod import removed.
- [x] `src/permission/next.ts` — `Action`, `Rule`, `Ruleset` (mutable), `Request`, `Reply`, `Approval` migrated; `ReplyInput` migrated to `Schema.Struct(...)` reusing the existing `ReplySchema` literal and `Identifier.schemaEffect("permission")`. `AskInput` stays Zod-pinned because `Request.partial({id:true}).extend({ruleset})` uses Zod-only `.partial()`.
- [x] `src/mobile/auth.ts` — `MobileAuth.Token` migrated to `Schema.Struct(...).annotations({identifier: "MobileAuthToken"})` + `zodObject(...)`. `PublicToken` keeps `.omit({hash:true}).meta({...})` chain Zod-side because the omit() result needs the existing Zod ref-meta annotation. Zod import preserved for that one call site.
- [x] `src/mobile/expo.ts` — `Expo.StartOptions` and `BuildOptions` migrated to `Schema.Struct` + `zodObject`. Zod import removed.
- [x] `src/auth/index.ts` — `Oauth`, `Api`, `WellKnown`, `Info` (Schema.Union), `WellKnownAuthResponse`. `accountId` writes use spread to satisfy readonly `Auth.Info`.
- [x] `src/background/run.ts` — `Status` / `Source` / `Role` literal enums + `Record` (`DeepMutable<...>`).
- [x] `src/bun/index.ts` — `BunProc.InstallFailedError` payload migrated to `zodObject(Schema.Struct({...}))`. Zod import removed.
- [x] `src/connectors/index.ts` — `Connectors.StatusSchema` (4-variant tagged union with per-variant `identifier` annotations; outer `ConnectorStatus` ref preserved) migrated to `Schema.Union(...)`, public `StatusSchema` derived via `zod(...)`.
- [x] `src/delegation/manager.ts` — `Delegation.Status` migrated to `Schema.Literal(...)`; `DelegationCompletedEvent` payload migrated to `Schema.Struct(...)` through the Schema-aware `BusEvent.define` overload, sharing the literal with `Status`.
- [x] `src/bus/bus-event.ts` — `BusEvent.define` now has a Schema.Struct overload
      that derives via `zodObject`, preserving field types. Zod-only callers
      continue to pass Zod directly. The `payloads()` union generator still
      builds Zod from the stored `properties` (Zod derived or Zod-native).
- [x] `src/bus/index.ts` — `Bus.InstanceDisposed` uses `Schema.Struct` with
      `zodObjectMode("strip")`. Remaining `z` imports are `z.output` / `z.infer`
      type annotations on the `BusEvent.Definition` generics (compat bridge, not
      a parallel source of truth).
- [x] `src/cli/cmd/tui/config/tui-migrate.ts`
  - File does not exist on this branch; current config files live under
    `src/config/`.
- [x] `src/cli/cmd/tui/config/tui-schema.ts`
  - File does not exist on this branch; active TUI config schema is
    `src/config/tui-schema.ts`.
- [x] `src/cli/cmd/tui/config/tui.ts`
  - File does not exist on this branch; active TUI config module is
    `src/config/tui.ts`.
- [ ] `src/cli/cmd/tui/event.ts` — Intentionally Zod-pinned. `TuiEvent` types
      feed directly into TUI component type inference (`ToastInput`, `ToastParsed`)
      and hono-openapi validators. The `BusEvent.Definition` generic needs precise
      Zod field types to preserve `z.enum()` / `.default()` discrimination at call
      sites. Revisit once `zodObject` typed overload preserves field-level inference
      through `BusEvent.define` for enums and default values.
- [x] `src/cli/ui.ts` — `UI.CancelledError` migrated from `z.void()` to
      `zod(Schema.Undefined)`.
- [ ] `src/command/index.ts` — Intentionally Zod-pinned. `Command.Info` uses
      `z.promise(z.string()).or(z.string())` which has no Effect Schema equivalent
      (Promise coercion is Zod-only). `Command.Event.Executed` is already Effect
      Schema with `zodObjectMode("strip")`.
- [x] `src/connectors/auth.ts` — `ConnectorAuth.Entry` with shared `DeepMutable<...>` (mutated by `updateToken`/`updateBotToken`/`updateApiKey`).
- [x] `src/control-plane/adapters/worktree.ts` — file does not exist on this branch.
- [x] `src/control-plane/types.ts` — file does not exist on this branch.
- [x] `src/control-plane/workspace.ts` — file does not exist on this branch.
- [x] `src/file/index.ts` — `Node` and `Content` (with nested patch sub-struct) migrated. `File.Info` migrated to `Schema.Struct(...)` with `Schema.int()` refinement and `Schema.Literal("added"|"deleted"|"modified")`. `Event.Edited` payload moved to `Schema.Struct` through Schema-aware `BusEvent.define` overload. Zod import removed.
- [x] `src/file/ripgrep.ts` — file does not exist on this branch.
- [x] `src/file/searchBackend.ts` — `Backend` (Schema.Literal) and `Match` (`Schema.mutable(Schema.Array(...))` over submatches).
- [x] `src/file/watcher.ts` — `FileWatcher.Event.Updated` uses `BusEvent.define`
      with `Schema.Struct` + `zodObjectMode("strip")`. No Zod-first schemas remain.
- [x] `src/format/index.ts` — `Formatter.Status` migrated to Effect Schema with `zodObject(...)`.
- [x] `src/ide/index.ts` — `Ide.Event.Installed` uses `Schema.Struct` +
      `zodObjectMode("strip")`. `Ide.AlreadyInstalledError` and `Ide.InstallFailedError`
      use `zodObject(Schema.Struct(...))`. No Zod-first schemas remain.
- [x] `src/installation/index.ts` — `Info` migrated; `Event.Updated` /
      `Event.UpdateAvailable` payloads moved to `Schema.Struct(...)` through
      the Schema-aware `BusEvent.define` overload; `UpgradeFailedError`
      payload migrated to `zodObject(Schema.Struct(...))`. Zod import removed.
- [x] `src/lsp/client.ts` — `LSPClient.InitializeError` uses
      `zodObject(Schema.Struct(...))`; `LSPClient.Event.Diagnostics` uses
      `Schema.Struct` + `zodObjectMode("strip")`. No Zod-first schemas remain.
- [ ] `src/lsp/index.ts` — migration attempt reverted; blocked on walker nested-struct shape inference (see MASTER-PLAN 2026-05-08 log).
- [x] `src/lsp/lsp.ts` — file does not exist on this branch.
- [x] `src/mcp/auth.ts` — `Tokens`, `ClientInfo`, `Entry` migrated; all carry `DeepMutable<Schema.Schema.Type<typeof Schema>>` because the impl mutates entries in place (`entry.tokens = tokens`, `delete entry.codeVerifier`, `entry.serverUrl = serverUrl`).
- [x] `src/mcp/index.ts` — `Resource` (Schema.Struct, `zodObject`) and `Status` (Schema.Union of five tagged variants, each with matching `identifier` annotation, `zod(...)` because outer is union not struct).
- [x] `src/monitor/manager.ts` — `Status`, `Record` (DeepMutable), `LogSnapshot` migrated.
- [x] `src/patch/index.ts` — `PatchSchema` authored as Effect Schema (`PatchSchemaEffect`);
      `PatchSchema` derived via `zodObject(PatchSchemaEffect)`. No parallel Zod source.
- [ ] `src/plugin/github-copilot/models.ts`
  - GitHub Copilot API response parser is Zod-first; migrate only after
    deciding whether provider SDK wire parsers are in Phase P scope or
    intentionally external-protocol pinned.
- [x] `src/project/project.ts` — `Info`, `UpdateInput` migrated. `DeepMutable<...>`. Extracted `IconSchema` for `Info.shape.icon` access.
- [x] `src/project/vcs.ts` — `Vcs.Info` migrated. `Event.BranchUpdated` payload moved to `Schema.Struct(...)` through Schema-aware `BusEvent.define` overload. Zod import removed.
- [x] `src/pty/index.ts` — `Pty.Info`, `CreateInput`, `UpdateInput` migrated. Status enum, env via `Schema.Record`, nested optional struct for size.
- [x] `src/question/index.ts` — `Option`, `Info`, `Answer` migrated.
- [x] `src/sandbox/types.ts` — `Ref` and `State` (Schema.Union over tagged variants); `RefSchema` / `StateSchema` re-exported.
- [x] `src/skill/skill.ts` — `Info`, `CreateInput` migrated. `Schema.optionalWith(..., {default})` for `scope`. `InvalidError` and `NameMismatchError` payloads moved to `zodObject(Schema.Struct({...}))`; `InvalidError.issues` uses the canonical `ZodOverride` for `z.core.$ZodIssue[]` (same pattern as `config/paths.ts`).
- [x] `src/sandbox/registry.ts` — `SandboxNotFoundError` payload migrated to `zodObject(Schema.Struct({workspaceID: Schema.String}))`. Zod import removed.
- [x] `src/snapshot/index.ts` — `Patch` and `FileDiff` migrated; `files` array uses `Schema.mutable`. Zod import removed.
- [x] `src/storage/db.ts` — no Zod schema definitions found in current audit.
- [x] `src/storage/storage.ts` — `NotFoundError` migrated. Zod-first schema
      replaced by Effect Schema `NotFoundErrorSchema` with `zodObject(...)` derivation;
      `InvalidError` similarly. No parallel Zod source remaining.
- [ ] `src/sync/index.ts` — `SyncEvent.define` and registered event
      payloads mixed: event schemas are Effect Schema with `zodObjectMode("strip")`
      derivation, but `SyncEvent.emit` and `Sync.namespace` still take `z.ZodType`
      generic parameters. The type-level `ZodType` references are compat bridges
      (match `BusEvent.Definition` pattern). Completes once `Sync.Service` is
      effectified in Phase I.
- [ ] `src/util/fn.ts`
  - Generic helper is intentionally Zod-typed today; either keep as a
    compatibility helper or introduce a Schema equivalent when a caller needs
    it.
- [x] `src/util/log.ts` — `Log.Level` migrated.
- [x] `src/util/update-schema.ts` — file does not exist on this branch.
- [x] `src/workspace/config.ts` — `Workspace.Config` (Schema.Union of `worktree | container`).
- [x] `src/workspace/index.ts` — `ConnectionStatus`, `Info`, `Restore`, `SessionRestore` migrated.
- [x] `src/worktree/index.ts` — `Info`, `CreateInput`, `RemoveInput`, `ResetInput` migrated. Six `WorktreeNotGitError` / `NameGenerationFailedError` / `CreateFailedError` / `StartCommandFailedError` / `RemoveFailedError` / `ResetFailedError` NamedError payloads collapsed into one shared `MessagePayload` derived from `Schema.Struct({message: Schema.String})`.

### Do-not-migrate

- `src/util/effect-zod.ts` — the walker itself. Stays zod-importing forever
  (it's what emits zod from Schema). Goes away only when the `.zod`
  compatibility layer is no longer needed anywhere.

## Notes

- **Walker now available**: `src/util/effect-zod.ts` ships the Effect Schema → Zod walker. Exports: `zod(schema)`, `zodObject(schema)`, `withStatics(...)`, `zodOverride(fn)`, `ZodOverrideId`, `DeepMutable<T>`, `zodObjectMode("strict" | "strip" | "passthrough")`. Coverage: structs, arrays, unions, literals, records, NullOr, optional, optionalWith default, primitives, the canonical refinements (`isInt`, `isGreaterThan*`, `isLessThan*`, `isPattern`, `isUUID`, `isMinLength`, `isMaxLength`, `isMinItems`, `isMaxItems`), `NumberFromString` → `z.coerce.number()`, Suspend/lazy, Declaration surrogates, Enums. Validated by `bun test test/util/effect-zod.test.ts` (≥22 tests). Constructs not yet supported fall back to `z.unknown()`; extend the walker switch when a new construct first appears in `src/`.
- **`zodObject` overload set**: typed `Schema.Struct<Fields>` returns `z.ZodObject<FieldsToShape<Fields>>` (preserves `.shape` / `.omit` / `.partial` / `.merge` / `.extend` field types); broad `Schema.Schema<A,I,R>` returns `z.ZodObject<z.ZodRawShape>` for `Schema.mutable(...)`-wrapped or otherwise non-Struct compositions. Use `DeepMutable<typeof FooSchema>` from `@/util/effect-zod` instead of `Schema.mutable(Schema.Struct(...))` when you need both runtime mutability and typed `.shape` access — the latter falls through to the broad overload and loses the typed shape.
- **`zodObjectMode` annotation**: schemas can opt out of the default `.strict()` behavior. Use `.annotations(zodObjectMode("strip"))` for forward-compatible payloads where unknown fields should be silently dropped (e.g. `SessionStatus.Info` variants), or `zodObjectMode("passthrough")` to keep them.
- **Optional-key handling for JSON Schema safety**: `Schema.optional(X)` strips the `Schema.Undefined` arm from the inner union so `z.toJSONSchema(...)` does not throw on `z.undefined()` arms. Verified by `test/util/effect-zod.test.ts → "Schema.optional inside Struct produces JSON-Schema-safe Zod"`.
- **Identifier / title / description filtering**: Effect's intrinsic annotations (`title="string"`, `description="a string"`, `identifier="NumberFromString"`, etc.) are filtered before being emitted as Zod metadata, so JSON Schema output stays clean.
- Use `@/util/effect-zod` for all Schema → Zod conversion.
- Prefer one canonical schema definition. Avoid maintaining parallel Zod and
  Effect definitions for the same domain type.
- Keep the migration incremental. Converting the domain model first is more
  valuable than converting every boundary in the same change.
- Every migrated file should leave the generated SDK output (`packages/sdk/
openapi.json` and `packages/sdk/js/src/v2/gen/types.gen.ts`) byte-identical
  unless the change is deliberately user-visible.
