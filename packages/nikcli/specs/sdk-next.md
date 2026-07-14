# sdk-next — embedded in-process SDK

Port of opencode's `packages/sdk-next` (dev branch) to nikcli: an Effect-native embedded host
for in-process applications, published as `@nikcli-ai/sdk-next` from `packages/sdk-next`.

## What it is

`NikCli.create({ directory? })` returns the generated typed client from `@nikcli-ai/sdk/httpapi`
wired to an in-memory `fetch` over `Server.App().fetch` (the real assembled Hono router). No
listener is opened and no network I/O happens, while routing, middleware (per-request instance
resolution, error mapping), handlers, and codecs are identical to the network client.

```ts
const nikcli = yield * NikCli.create({ directory })
const session = yield * Effect.promise(() => nikcli.session.create({ title: "embedded" }))
```

- Requests without their own `directory` query or `x-nikcli-directory` header are bound to the
  host's directory (default `process.cwd()`) via an injected `x-nikcli-directory` header; the
  server's existing instance middleware does the rest.
- `tools.register(...tools: Tool.Info[])` registers local-only tools into the host directory's
  instance-scoped `ToolRegistry` (same registry sessions and `/experimental/tool/ids` consult).
  This replaces shipping executable tool code over HTTP — mirrors opencode's `ApplicationTools`
  facade, mapped onto nikcli's per-instance registry.
- `NikCli.Service` / `NikCli.layer` adapt `create()` for Effect dependency injection.

## Differences vs opencode's sdk-next

| opencode                                                           | nikcli                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Executes Effect `HttpRouter.toWebHandler(createEmbeddedRoutes())`  | Executes the Hono app's `fetch` directly (`Server.App()` is already an in-memory web handler)                                   |
| Per-host isolated routes/services; scope close disposes router     | Hono app and instance state are process-global singletons; `create()` is non-destructive and holds no scoped resources          |
| Host-level `ApplicationTools`, per-Location `ToolRegistry` overlay | Per-instance (project directory) `ToolRegistry.register`; tools are host-directory scoped                                       |
| Effect-native generated client (`@opencode-ai/client/effect`)      | Promise-based generated client (`NikCli.make({ baseUrl, fetch })` from httpapi-codegen output) wrapped in an Effect constructor |

## Tests

`packages/sdk-next/test/embedded.test.ts` drives the real router in memory: session
create/list/config, tool registration visible through `/experimental/tool/ids`, per-call
directory override, per-directory tool scoping, and the Layer service form.
`test/import-boundaries.test.ts` asserts a Bun bundle of the package contains both the sdk
client sources and the nikcli host sources (the "in-process host" property).

Run from `packages/sdk-next`: `bun run test`, `bun run typecheck`.

## Follow-ups

- Migrate in-process consumers (TUI worker, `run` command, simulation harness) from ad hoc
  `Server.App()` fetches to `@nikcli-ai/sdk-next`.
- Consider an Effect-native generated client (httpapi-codegen `emitEffectImported`) so client
  calls are Effects instead of promises, matching opencode fully.
