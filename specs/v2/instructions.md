# V2 Service Instructions

| Field  | Value                                                                        |
| ------ | ---------------------------------------------------------------------------- |
| Status | **Working agreement** — conventions, not a contract                          |
| Scope  | `packages/nikcli/src/**` domain services, `packages/util`, `packages/plugin` |
| Buys   | One shape for a service, so the next port does not invent a third            |

These notes describe how to write and port services in `packages/nikcli/src` during the v2 work. They
describe the house style that already exists in `Provider`, `Project`, `Config`, `Session`, and
`ToolRegistry` — read one of those before starting, and follow it.

This is the nikcli counterpart to opencode's `specs/v2/instructions.md`. The direction is the same;
the mechanics are not, because nikcli has no `packages/core`.

## Direction

Move behavior out of large application modules and into small typed services that own state, expose
a few domain verbs, and delegate policy to configuration, plugins, or the permission ruleset.

The target shape:

- Domain modules own schemas, typed errors, per-instance state, events, and a narrow interface.
- `packages/util` holds what is genuinely shared and dependency-light: `global`, `flag`, `log`,
  `filesystem`, `effect-zod`. Adding to it costs every consumer, so add reluctantly.
- `packages/llm`, `packages/plugin`, `packages/sdk-next`, and `packages/tui` are consumers, never
  hosts of domain logic.
- The server (`src/server/httpapi/*`) is transport. A handler resolves a service and calls one
  method; it does not contain domain branches.

There is no separate core package and **this is not a proposal to create one.** nikcli's isolation
boundary is the per-instance service, not the package. A service that could live in a core package is
already correct where it is if it takes its dependencies through Effect context.

## Service Shape

Look at `Provider`, `Project`, and `ProjectCopy`. A service module is:

```ts
export namespace Thing {
  const log = Log.create({ service: "thing" })

  // 1. Schemas at the top, Effect Schema first
  export const InfoSchema = Schema.Struct({ … }).annotate({ identifier: "Thing" })
  export const Info = zodObject(InfoSchema)          // only if the wire needs it
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  // 2. Typed errors for expected failures
  export class NotFound extends Schema.TaggedError<NotFound>()("ThingNotFound", {
    id: Schema.String,
  }) {}

  // 3. Bus events for committed facts
  export const Event = { Updated: BusEvent.schema("thing.updated", InfoSchema) }

  // 4. A small interface
  export interface Interface {
    get(id: string): Effect.Effect<Info, NotFound>
    list(): Effect.Effect<Info[]>
    update(input: UpdateInput): Effect.Effect<Info, NotFound>
  }

  // 5. A Context.Service tag
  export class Service extends Context.Service<Service, Interface>()("Thing.Service") {}

  // 6. A layer, and a defaultLayer naming its dependencies
  export const layer = Layer.effect(Service, Effect.gen(function* () { … }))
  export const defaultLayer = layer
}
```

Prefer small domain verbs — `get`, `list`, `update`, `remove`, `refresh` — over one method that takes
a mode flag. If a method needs a boolean parameter to choose between two behaviors, it is two
methods.

## State Is Per Instance

nikcli's unit of isolation is a **directory**, not a process. State that depends on the project,
worktree, config, or credentials belongs in `InstanceState.make(init, { reloadable })`, not in a
module-level `let`.

```ts
const state = InstanceState.make(
  (ctx) =>
    Effect.gen(function* () {
      /* build from ctx.directory */
    }),
  { reloadable: true },
)
```

Two rules that are easy to get wrong, both recorded in
[catalog-config-plugin-lifecycle.md](./catalog-config-plugin-lifecycle.md):

- **`reloadable: true` only if the state can be rebuilt from files.** State owning a live resource or
  accumulating runtime-only registrations must not be reloadable, because invalidation would silently
  drop it. A service with both splits them into two caches — `tool/registry.ts` is the worked
  example.
- **Never read `Instance.project.id` inside a forked fiber.** Read it in caller scope and pass it in.
  Reading it from a fiber that lost the ambient context produces "No context found for instance",
  which is a runtime failure with no compile-time signal.

Singletons that hold a path must re-resolve the path on access. `bun test` swaps `NIKCLI_TEST_HOME`
per file, so a path captured at module load is stale for every file after the first.

## Errors

Expected failures are typed:

```ts
export class CopyError extends Schema.TaggedError<CopyError>()("ProjectCopyError", {
  message: Schema.String,
  directory: Schema.optional(Schema.String),
  forceRequired: Schema.optional(Schema.Boolean),
}) {}
```

Carry the fields a caller needs to **act**, not the fields that happen to be in scope.
`forceRequired` exists so a client can prompt for confirmation; a stringified cause would not have
let it.

Translate at boundaries. `ProjectCopy` catches `WorktreeRemoveFailedError` and re-raises its own
typed error rather than leaking the worktree layer's error type into its signature.

Use `Effect.orDie` only where failure is genuinely unrecoverable at that layer — HTTP handlers that
have no better answer than a 500. Do not use it to avoid declaring an error type.

## Schemas

Effect Schema is the source of truth. Derive zod from it with `zodObject` when a wire format or JSON
Schema needs it — never the other way round.

There is exactly one deliberate exception in the codebase, and it is documented as such: `nikcli.json`
is authored in zod and converted to Effect (`util/zod-effect.ts`), because the published JSON Schema
is the user-facing contract. Do not add a second exception.

Tool input schemas are the other zod surface (`Tool.define` takes a zod object, which becomes the
model-facing JSON Schema). That is authoring, not derivation — see [tools.md](./tools.md).

Annotate every struct with `identifier`; it is what names the type in the generated OpenAPI document
and the SDK.

**Strict schemas on HTTP responses are validated at runtime.** The Effect bridge checks response
bodies where Hono did not, so a field you marked required because it "should always be there" will
break a live surface the first time a real payload omits it. Curl the route against real data before
tightening a schema.

## Events

Publish events for **committed facts**, not attempted mutations. Name them after the fact:
`project.updated`, `catalog.model.updated` — not `project.update.requested`.

Events cross the process boundary, so decide deliberately whether a new event is public. See
[public-event-filter.md](./public-event-filter.md): withheld means absent from the feed, not a typed
"redacted" placeholder.

Inside a transaction, use `Database.effect(...)` to defer publication until after the commit. An
event published from inside a transaction that later rolls back is a lie that clients cannot detect.

## Plugins

`@nikcli-ai/plugin` is the public extension type. Plugin-provided behavior enters through the paths
that already exist — auth loaders, tool registration, hooks — and autoload is fail-closed with an
allowlist and sha256 pins ([tool-plugin-autoload-security.md](./tool-plugin-autoload-security.md)).

nikcli does not have upstream's `PluginV2.HookSpec` with Immer drafts and `cancel` flags. Do not
build half of it for one service. If a real integration needs a hook, propose the hook surface as its
own document first.

## Style

- `Effect.gen(function* () { … })` for composition.
- `Effect.fn("Domain.method")` for public service methods — the name is what appears in traces.
- `yield* new ErrorClass(…)` for typed failures.
- No `any` unless a plugin or SDK boundary genuinely requires it, and then with a comment saying
  which boundary.
- Comments explain **why**, not what. The existing codebase is dense with load-bearing comments
  ("disable mmap so the process footprint doesn't grow with the DB file size"); match that density,
  not a higher one.
- No compatibility code without a concrete persisted or external-consumer need. The counter-example
  is instructive: `jsonSafe` in the httpapi round-trip _is_ load-bearing, because deleting it puts
  `null` on the wire instead of omitting the key.

## Porting Checklist

When moving behavior out of a large module:

1. Identify the state it owns and whether that state is per-instance or per-process.
2. Identify the operations callers actually use — grep the call sites, do not guess from the exports.
3. Identify which branches are policy (config, permissions, plugins) rather than domain logic.
4. Model the schemas and the interface first; implement second.
5. Leave the old entry points working until every caller has moved.
6. Add the test that would fail if the behavior changed, then write the spec entry that names it.

Prefer the smallest correct port. The goal is services that are easier to replace, not a faithful
reproduction of the old architecture in new syntax.

## Verification

- `bun run typecheck` — never a bare `tsc`; the root `.bin/tsc` is the JS 5.x compiler, not the
  native 7.0 one. Run it **once**, after all edits.
- `bun test <path>` for the suites you touched; `bun run test:ci` for the whole sharded suite.
- Never verify with `packages/simulation`. It is slow and flaky; unit tests are the contract.
- **A test that needs a `NIKCLI_*` variable must declare it.** `test/preload.ts` installs a
  `beforeEach` that deletes every `NIKCLI_*` and `XDG_*` variable outside its captured baseline, so a
  plain `process.env.X = …` — at module scope or in `beforeAll` — is gone before the first `it` runs.
  Use `preserveTestEnv([...])` from `test/helpers/env.ts`. The failure is not an error: the code under
  test falls back to its production default, which for `NIKCLI_DB` means writing test rows into the
  developer's real `~/.local/share/nikcli/nikcli.db`. Assert the resolved value in the first test of
  any suite that redirects one.
- Formatting comes from the root `package.json` `prettier` block (`semi: false`, width 120). Do not
  run bare `bunx oxfmt` — it has no repo config and rewrites whole files with stock defaults.

## Documentation Rule

A behavior change that alters a durable shape, a wire contract, or an invariant named in this
directory updates the corresponding document **in the same commit**. Schema-shape changes also get an
entry in [schema-changelog.md](./schema-changelog.md), newest first.

A document in this directory earns **Accepted and implemented** by having a test that fails when the
behavior changes. A new document may enter as `Proposed`, and while it does it carries a **Missing**
row naming the one test that would promote it.
