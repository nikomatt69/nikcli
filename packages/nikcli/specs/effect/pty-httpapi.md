# /pty HttpApi port — design (Wave 4)

> Status (2026-07-08): **CRUD Path B landed** (`src/server/httpapi/pty.ts` + bridge
> inventory). WebSocket `GET /pty/:ptyID/connect` remains a **Hono special** until
> `BunHttpServer.upgradeWebSocket` ships. This ADR freezes that decision for misty-moon B5.

## 1. Background

`src/pty/index.ts` already exposes a fully-formed Effect `Context.Service`:

```ts
export interface Interface {
  readonly list: () => Effect.Effect<Info[], never>
  readonly get: (id: string) => Effect.Effect<Info | undefined, never>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
  readonly update: (id: string, input: UpdateInput) => Effect.Effect<Info | undefined, never>
  readonly remove: (id: string) => Effect.Effect<void, never>
  readonly resize: (id: string, cols: number, rows: number) => Effect.Effect<void, never>
  readonly write: (id: string, data: string) => Effect.Effect<void, never>
  readonly connect: (id: string, ws: WSContext) => Effect.Effect<Connection | undefined, never>
}
export class Service extends Context.Service<Service, Interface>()("@nikcli/Pty") {}
```

`routes/pty.ts` calls every CRUD method 1:1 — the only Hono-specific
piece is the WebSocket upgrade at `GET /pty/:ptyID/connect` using
`upgradeWebSocket(...)` from `hono/bun`. CRUD endpoints map cleanly to
`HttpApiEndpoint`s.

## 2. Target CRUD surface — `src/server/httpapi/pty.ts`

```ts
export namespace PtyHttpApi {
  const ListResponse = Schema.Array(Info)
  const PtyIDPath = Schema.Struct({ ptyID: Schema.String })

  export const Group = HttpApiGroup.make("pty")
    .add(HttpApiEndpoint.get("list", "/", { success: ListResponse }))
    .add(HttpApiEndpoint.post("create", "/", { payload: CreateInput, success: Info }))
    .add(HttpApiEndpoint.get("get", "/:ptyID", { params: PtyIDPath, success: Info, error: NotFoundError }))
    .add(HttpApiEndpoint.put("update", "/:ptyID", { params: PtyIDPath, payload: UpdateInput, success: Info }))
    .add(HttpApiEndpoint.delete("remove", "/:ptyID", { params: PtyIDPath, success: Schema.Boolean }))
    .prefix("/pty")

  // Handlers: thin Effect.gen wrappers that yield Pty.Service.

  export const DependenciesLive = Layer.mergeAll(
    Pty.defaultLayer, // provides @nikcli/Pty
    PtyEnvironment.Service.Default, // provides @nikcli/PtyEnvironment
  )
}
```

Notes:

- `Info`, `CreateInput`, `UpdateInput` are `zodObject` codecs
  (`src/pty/index.ts:34, 44, 56`). The HttpApi `Group` declares
  `success: Info`, `payload: CreateInput`, etc. — the existing
  `httpapi/connectors.ts:32-49` pattern uses the same shape.
- `NotFoundError`: mirror `routes/pty.ts:107` body
  `{ error: "Session not found" }`. The Schema-tagged error class lives
  here: `class PtyNotFoundError extends Schema.TaggedErrorClass(...)`.
- `Pty.CreateError` (`src/pty/index.ts:78`) maps to `400` via
  `Schema.annotate({ httpApiStatus: 400 })` mirror of
  `httpapi/connectors.ts:14-17`.
- `DependenciesLive` includes `PtyEnvironment.Service.Default`
  (`src/pty/environment.ts:18`) because `Pty.create` yields
  `PtyEnvironment.Service.get(...)` for the env overlay.

## 3. WebSocket upgrade — two paths

### Path A (preferred, blocked on upstream `@effect/platform-bun`)

Keep the WS on the Effect backend by adapting
`hono/bun`'s `upgradeWebSocket` via `HttpApiBuilder.handleRaw`:

```ts
.addRaw(
  HttpApiEndpoint.get("connect", "/:ptyID/connect", {
    params: PtyIDPath,
    success: Schema.Boolean,
  }),
)

// In the handler:
.handleRaw("connect", ({ params }) =>
  Effect.gen(function* () {
    const upgrade = yield* BunHttpServer.upgradeWebSocket(...) // not yet shipped
    const pty = yield* Pty.Service
    return yield* pty.connect(params.ptyID, upgrade.wsContext)
  }),
)
```

**Constraint**: `BunHttpServer.upgradeWebSocket(...)` is not part of
`@effect/platform-bun` today. Until it ships, Path A is aspirational.

### Path B (interim, **recommended for this PR**)

CRUD on Effect HttpApi; WS continues on Hono via the same fall-through
that already serves `/event` and `/chatbot/*`:

1. Add 5 regex entries to `HttpApiBridge.implementedRoutes`:
   ```ts
   ["GET",    /^\/pty\/?$/],
   ["POST",   /^\/pty\/?$/],
   ["GET",    /^\/pty\/[^/]+\/?$/],
   ["PUT",    /^\/pty\/[^/]+\/?$/],
   ["DELETE", /^\/pty\/[^/]+\/?$/],
   ```
2. **Do not** add `["GET", /^\/pty\/[^/]+\/connect$/]` — it stays Hono.
3. No changes to `routes/pty.ts`. The Hono file keeps serving WS while
   the CRUD surface moves.
4. When `--httpapi` is off (production default), CRUD still goes to Hono.

### Path comparison

|                                | Path A (preferred)               | Path B (interim)    |
| ------------------------------ | -------------------------------- | ------------------- |
| CRUD endpoint source           | Effect `HttpApi`                 | Effect `HttpApi`    |
| WS endpoint source             | Effect `HttpApi` (handleRaw)     | Hono (fall-through) |
| OpenAPI surface                | Full                             | CRUD only           |
| SDK generator emits WS method? | Yes                              | No                  |
| Dependencies                   | `BunHttpServer.upgradeWebSocket` | None new            |
| Risk                           | Blocked on upstream              | Low                 |

## 4. Decision (ADR misty-moon B5 — 2026-07-08)

**Path B adopted and shipped for CRUD.**

| Surface                                    | Source of truth                                          | Notes                                            |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| PTY CRUD (`list/create/get/update/remove`) | Effect `PtyHttpApi` when `NIKCLI_EXPERIMENTAL_HTTPAPI=1` | Bridged; inventory green                         |
| PTY WebSocket `/pty/:id/connect`           | **Hono forever-until-upstream**                          | Not in `implementedRoutes`; `routes/pty.ts` only |

**Do not** attempt Path A in this cycle. Revisit only when:

1. `@effect/platform-bun` (or BunHttpServer) exposes `upgradeWebSocket`, **and**
2. Effect OpenAPI/SDK default flip is planned (B2 opt-in already exists).

Reasoning unchanged: same-day shippability; mirrors `/event` SSE and `/chatbot/*` specials.

## 5. Inventory impact

After Path B lands:

- `implementedRoutes` gains 5 entries (CRUD).
- `Inventory script` `bun run script/httpapi-bridge-inventory.ts` gains
  5 cases (all `expect: true`).
- `specs/httpapi-bridge-inventory.md` line "Missing from bridge / PTY"
  moves from "WS `pty.connect` — classify special" to a `[bridged]`
  row with a note pointing back here for the WS upgrade path.

## 6. Open questions

- **`WSContext` is `hono/ws`-typed.** `Pty.Service.connect(id, ws: WSContext)`
  references the type. If/when Path A lands, this becomes a
  `@effect/platform-bun` native socket type — a public-API change that
  `routes/mobile/pty.ts` will need to follow up on.
- **`PtyEnvironment.Service.Default` is a `Layer.succeed`.** When the
  real test override is needed, the existing `httpapi/workspace.ts`
  pattern of `Layer.provide(...)` in `DependenciesLive` carries over.

## 7. Cross-references

- `specs/effect/http-api.md` step 15 — currently holds the design
  summary; expand with link to this file.
- `specs/httpapi-bridge-inventory.md` "Missing from bridge / PTY" row —
  annotate with "(see `specs/effect/pty-httpapi.md`)".

## 8. Out of scope for this PR

- No implementation of `httpapi/pty.ts`.
- No changes to `routes/pty.ts`.
- No SDK regeneration.
