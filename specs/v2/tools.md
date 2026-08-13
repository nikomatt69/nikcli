# Tools

Status: **Current semantic overview** (verified 2026-08-14 against `packages/nikcli/src/tool`).

`Tool` (`src/tool/tool.ts`) owns the authoring contract and the wrapper that normalizes it. `ToolRegistry` (`src/tool/registry.ts`) owns discovery, filtering, ordering, and resolution. `SessionTools` and `SessionProcessor` own invocation and the durable tool state machine. `@nikcli-ai/plugin` owns the public plugin tool type.

## One Structural Tool Value

A tool is authored once and identified separately:

```ts
export const GrepTool = Tool.define("grep", async () => ({
  description: PROMPT,
  parameters: z.object({ pattern: z.string(), path: z.string().optional() }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => ctx.ask({ ... }))
      return { title: args.pattern, output, metadata: { matches } }
    }),
}))
```

`Tool.define(id, init)` takes an id and an **initializer**, not a finished definition. The initializer runs per resolution with `{ agent }`, so a tool can vary its description or schema by agent. It may also be a plain object when nothing needs to be computed.

Input schemas are **zod**, not Effect Schema, and not Standard Schema. The zod object is what becomes the model-facing JSON Schema, so tool authoring is the one place in the codebase where zod is still the contract language rather than a derivation of it.

`execute` may return a `Promise` or an `Effect`; `Tool.define` normalizes both into an Effect-returning `Def.execute` and additionally exposes `executeAsync` as a thin `AppRuntime.runPromise` wrapper. New tools should target the Effect shape directly. Both are present on every wrapped tool, so no call site needs to know which shape the author used.

## One Response Value, Not Three

A tool returns exactly one shape:

```ts
interface Tool.Result<M> {
  title: string                        // UI label
  output: string                       // model-facing content, stored durably
  metadata: M                          // compact JSON for tool-specific UI
  attachments?: MessageV2.FilePart[]   // images and files handed back to the model
}
```

There is no separate schema-validated machine `output` distinct from model-facing content: `output` is a string and is both. Code Mode (`src/codemode/tool-runtime.ts`) consumes that same string; it does not receive a validated encoded value.

> **Consequence.** A tool cannot declare an output schema, so Code Mode cannot type its own call results, and the registry cannot reject a malformed success. This is the largest remaining divergence from the upstream tool contract. See ROADMAP item T2.

## Validation And Truncation Belong To The Wrapper

`Tool.define`'s wrapper does four things around every call, so no individual tool repeats them:

1. **Parse.** `parameters.parse(args)` runs before `execute`. A `ZodError` becomes an `Error` carrying either the tool's own `formatValidationError` message or a generic "rewrite the input so it satisfies the expected schema" instruction. Invalid input never reaches the tool.
2. **Default metadata.** `ctx.metadata` is wrapped so `truncated` defaults to `false` rather than being absent.
3. **Truncate.** Unless the tool already set `metadata.truncated`, the output goes through `Truncate.output(...)` with the resolving agent. When content is cut, `metadata.truncated` becomes `true` and `metadata.outputPath` points at the retained full text.
4. **Fail soft on truncation.** A failing truncation falls back to the raw output. The comment in the source is the reason it is written that way: a `try/catch` around a `yield*` would not see Effect failures, and a rejected `Effect.promise` would kill the fiber as a defect.

A tool that sets `metadata.truncated` itself is trusted and skipped — that is how producers with their own capture limits (process output, web fetch) keep ownership of their loss reporting.

## Every Call Carries Its Invocation Identity

```ts
type Tool.Context = {
  sessionID: string
  messageID: string          // the assistant message containing the call
  agent: string
  callID: string             // the id durable tool events use
  abort: AbortSignal
  extra?: Record<string, unknown>
  messages?: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): void
  progress(input: Progress): Promise<void>
  ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
}
```

The session runner owns these associations and supplies the complete context; the registry never infers them.

Cancellation is an `AbortSignal`, not Effect interruption. Tools pass `ctx.abort` to the work they start. This is deliberate: most tool bodies bottom out in `fetch`, `Bun.spawn`, or an SDK that accepts a signal.

Permissions are formulated by the tool through `ctx.ask`, which merges the agent ruleset with the session ruleset. The registry does not inject a permission helper, and sharing the tool type does not imply equal authority: built-ins capture trusted services that plugin tools cannot reach.

## Registration Is A Flat Instance-Scoped List

The registry keeps one `custom: Tool.Info[]` per instance, built once in `InstanceState`:

1. Config-directory `{tool,tools}/*.{js,ts}` files — **only** when `NIKCLI_ALLOW_PLUGIN_AUTOLOAD` is set or `tool.allow` is non-empty. Each candidate must match the allowlist by absolute path, basename, or stem, and if `tool.pin[...]` names it, its SHA-256 must match or it is refused.
2. Tools contributed by loaded plugins.
3. Runtime registrations through `register(tool)` — the sdk-next `tools.register` path.

`register` replaces by id if present, otherwise appends. There is **no scope, no removal, and no overlay stack**: a later registration for a name destroys the earlier one permanently, and closing a plugin cannot reveal what it shadowed. The `InstanceState` entry is deliberately not `reloadable`, because a config-driven invalidation would silently drop runtime registrations that exist nowhere else.

## Resolution Is Per Request, Ordered, And Filtered

`tools(model, agent, options)` returns the resolved set for one request:

- **Client filter.** `question` is registered only for the `app`, `cli`, and `desktop` clients.
- **Flag filters.** `lsp`, `plan_enter`/`plan_exit`, `browser_control`, and `computer` are flag-gated. `code_mode` is default-on and opts out through `NIKCLI_DISABLE_CODE_MODE`; the unconfined `exec_code` predecessor is deprecated and no longer registered. `batch` is config-gated.
- **Provider filter.** `codesearch` and `websearch` require the `nikcli` provider or `NIKCLI_ENABLE_EXA`.
- **Model-family filter.** GPT models (excluding `gpt-4` and `oss`) get `apply_patch` and lose `edit`/`write`/`multiedit`; every other model gets the reverse. A model that received both would be offered two ways to write the same file.
- **Agent filter.** `advisor` requires `agent.advisor`.
- **Explicit exclusion.** `options.exclude` removes ids the caller already handled.

The surviving set is sorted by `compareIds`, a deliberately locale-independent comparison. The reason is stated in the source: the tool array is the first and largest component of the provider prompt-cache prefix, so an equivalent set of tools must serialize to identical bytes regardless of registration order or host locale. `localeCompare` would break the cache across machines.

Only then does each `Tool.Info.init({ agent })` run, timed per tool.

## Session Visibility Is A Second, Shared Filter

`ToolRegistry.visible(id, { disabledTools, ruleset })` is the per-session half of "can the model call this":

- `enabled(id, disabled)` is tri-state for `OPT_IN` tools. `opentui` is registered but excluded until an explicit `false` appears in `disabledTools` — it carries a large schema and description that would otherwise cost every prompt of every session. A registry-level flag would instead hide it from the `/usage` dialog entirely.
- A wholly-denied tool (pattern `*`) is invisible. Resource-scoped denies stay visible, because the tool still works on the allowed paths.

`resolveTools` and `search_tools` share this function on purpose. If they drifted, `search_tools` would advertise a tool absent from the model's schema and every call to it would come back as unknown.

## Plugin Tools Use The Same Shape

`fromPlugin(id, def)` adapts a `ToolDefinition` from `@nikcli-ai/plugin` into a `Tool.Info`: `z.object(def.args)` becomes the schema, a string result becomes `{ title: "", output, metadata: {} }`, and returned attachments are stamped with the current session and message ids. Config-directory tools are namespaced by filename (`default` export takes the bare stem, named exports become `stem_export`).

A Bun `plugin()` resolver is installed at module load so config-directory tools can `import "@nikcli-ai/plugin"` and resolve it against the installed CLI rather than their own directory.

## Laws

- **Single execution.** A wrapped tool can execute only the `execute` its author supplied.
- **Validated input.** Invalid input never executes the tool.
- **Wrapper-owned truncation.** Output bounding happens once, in the wrapper, unless the tool claims it.
- **Durable identity.** Invocation records use the exact session, agent, assistant message, and call ids the runner supplied.
- **Byte-stable advertisement.** An equivalent tool set serializes identically across machines, locales, and registration orders.
- **Shared visibility.** The set the model is offered and the set `search_tools` advertises come from one predicate.
- **Per-call rejection.** An unavailable or invalid call fails alone; it never fails a sibling call.
- **Interruption is a signal, not a result.** An aborted call is not a tool failure; it is reconciled at request assembly (see [session](./session.md)).
