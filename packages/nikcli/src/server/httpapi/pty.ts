import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Pty } from "@/pty"
import { PluginPtyEnvironment } from "@/plugin/pty-environment"
import { Storage } from "../../storage/storage"

/**
 * Effect backend for the `/pty` JSON CRUD surface (Wave 4, Path B).
 *
 * Mirrors `src/server/routes/pty.ts` for the five endpoints that map cleanly
 * onto `HttpApiEndpoint` schemas:
 *  - `GET    /pty`         → `pty.list`
 *  - `POST   /pty`         → `pty.create`
 *  - `GET    /pty/:ptyID`  → `pty.get`        (404 on miss)
 *  - `PUT    /pty/:ptyID`  → `pty.update`
 *  - `DELETE /pty/:ptyID`  → `pty.remove`
 *
 * The WebSocket upgrade at `GET /pty/:ptyID/connect` stays a Hono
 * "special" branch — `BunHttpServer.upgradeWebSocket` is not yet shipped in
 * `@effect/platform-bun`, so the bridge must fall through to
 * `routes/pty.ts` for that path. See `specs/effect/pty-httpapi.md`.
 *
 * `Pty.Info`, `Pty.CreateInput`, and `Pty.UpdateInput` are `zodObject` codecs
 * from `src/pty/index.ts` (built by `effect-zod`'s `zodObject`). They cannot
 * be used directly as `HttpApiEndpoint.success` / `payload` slots — those
 * require Effect `Schema` types. We redeclare the same shapes below as
 * `Schema.Struct` so the OpenAPI surface is generated from the Effect
 * schema, and the handler payloads are passed through `as unknown as …`
 * casts that are safe because the two schemas have identical field
 * definitions (mirror of `httpapi/app.ts` for `Skill`).
 */
export namespace PtyHttpApi {
  // ---- Local Schema re-declarations (mirror zodObject shapes) ----

  const PtyInfo = Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
    status: Schema.Literals(["running", "exited"]),
    pid: Schema.Number,
  }).annotate({ identifier: "Pty" })

  const PtyCreateInput = Schema.Struct({
    command: Schema.optional(Schema.String),
    args: Schema.optional(Schema.Array(Schema.String)),
    cwd: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }).annotate({ identifier: "PtyCreateInput" })

  const PtyUpdateInput = Schema.Struct({
    title: Schema.optional(Schema.String),
    size: Schema.optional(
      Schema.Struct({
        rows: Schema.Number,
        cols: Schema.Number,
      }),
    ),
  }).annotate({ identifier: "PtyUpdateInput" })

  const PtyList = Schema.Array(PtyInfo).annotate({ identifier: "PtyList" })

  const PtyIDPath = Schema.Struct({ ptyID: Schema.String }).annotate({
    identifier: "PtyIDPath",
  })

  /**
   * Mirrors `routes/pty.ts:107` body — `Storage.NotFoundError` is mapped to
   * a typed 404 so the SDK consumer can catch it.
   */
  const NotFoundError = Schema.Struct({
    name: Schema.Literal("NotFoundError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "PtyNotFoundError", httpApiStatus: 404 })

  /**
   * Mirrors `Pty.CreateError` (`src/pty/index.ts:78`). The underlying
   * service can fail when the OS rejects the PTY spawn (e.g. ENOENT for an
   * unknown command). We surface it as a 400 because it is a client error
   * — the caller passed a bad `command`. The shape matches the legacy
   * Hono 400 body so SDK consumers see the same field names regardless of
   * which backend serves them.
   */
  const CreateError = Schema.Struct({
    name: Schema.Literal("PtyCreateError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "PtyCreateErrorBody", httpApiStatus: 400 })

  type NotFoundErrorBody = typeof NotFoundError.Type
  type CreateErrorBody = typeof CreateError.Type

  export const Group = HttpApiGroup.make("pty")
    .add(HttpApiEndpoint.get("list", "/", { success: PtyList }))
    .add(
      HttpApiEndpoint.post("create", "/", {
        payload: PtyCreateInput,
        success: PtyInfo,
        error: CreateError,
      }),
    )
    .add(
      HttpApiEndpoint.get("get", "/:ptyID", {
        params: PtyIDPath,
        success: PtyInfo,
        error: NotFoundError,
      }),
    )
    .add(
      HttpApiEndpoint.put("update", "/:ptyID", {
        params: PtyIDPath,
        payload: PtyUpdateInput,
        success: PtyInfo,
        error: NotFoundError,
      }),
    )
    .add(
      HttpApiEndpoint.delete("remove", "/:ptyID", {
        params: PtyIDPath,
        success: Schema.Boolean,
      }),
    )
    .prefix("/pty")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  /**
   * Translate a `Storage.NotFoundError` to the declared 404 body. Anything
   * else propagates as a defect — the service surfaces `never` on success
   * channels for these handlers, so the only expected failure is "missing".
   */
  const asNotFound = (cause: unknown): Effect.Effect<never, NotFoundErrorBody> => {
    if (cause instanceof Storage.NotFoundError) {
      return Effect.fail({
        name: "NotFoundError" as const,
        data: { message: cause.message } as Record<string, unknown>,
      })
    }
    return Effect.die(cause)
  }

  const catchNotFound = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.catch(asNotFound), Effect.catchDefect(asNotFound))

  /**
   * Translate a `Pty.CreateError` to the declared 400 body. Anything else
   * propagates as a defect.
   */
  const asCreateError = (cause: unknown): Effect.Effect<never, CreateErrorBody> => {
    if (cause instanceof Pty.CreateError) {
      return Effect.fail({
        name: "PtyCreateError" as const,
        data: {
          command: cause.command,
          message: cause.message,
        } as Record<string, unknown>,
      })
    }
    return Effect.die(cause)
  }

  const catchCreateError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.catch(asCreateError), Effect.catchDefect(asCreateError))

  /**
   * Cast helpers — safe because `PtyCreateInput`/`PtyUpdateInput` are
   * re-declared with the same field shapes as the canonical
   * `Pty.CreateInput`/`Pty.UpdateInput` zodObjects. The zodObject schemas
   * are the source of truth for `pty.create`; the Schema.Struct here is
   * only used to feed the HttpApi validator.
   */
  const toPtyCreateInput = (input: typeof PtyCreateInput.Type): Pty.CreateInput => input as unknown as Pty.CreateInput
  const toPtyUpdateInput = (input: typeof PtyUpdateInput.Type): Pty.UpdateInput => input as unknown as Pty.UpdateInput

  export const handlers = {
    list: () =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        return yield* pty.list()
      }).pipe(Effect.orDie),

    create: ({ payload }: { payload: typeof PtyCreateInput.Type }) =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        return yield* pty.create(toPtyCreateInput(payload))
      }).pipe(catchCreateError),

    get: ({ params }: { params: { ptyID: string } }) =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        const info = yield* pty.get(params.ptyID)
        if (!info) {
          throw new Storage.NotFoundError({ message: "Session not found" })
        }
        return info
      }).pipe(catchNotFound),

    update: ({ params, payload }: { params: { ptyID: string }; payload: typeof PtyUpdateInput.Type }) =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        const info = yield* pty.update(params.ptyID, toPtyUpdateInput(payload))
        if (!info) {
          throw new Storage.NotFoundError({ message: "Session not found" })
        }
        return info
      }).pipe(catchNotFound),

    remove: ({ params }: { params: { ptyID: string } }) =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        // `pty.remove` is total — a missing session is a silent no-op
        // (`Pty.Service.remove` returns `Effect<void, never>`). The Hono
        // route mirrors this by returning 200 + `true` unconditionally.
        yield* pty.remove(params.ptyID)
        return true
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "pty", (builder) =>
    builder
      .handle("list", () => handlers.list())
      .handle("create", (request) => handlers.create(request))
      .handle("get", (request) => handlers.get(request))
      .handle("update", (request) => handlers.update(request))
      .handle("remove", (request) => handlers.remove(request)),
  )

  /**
   * `Pty.defaultLayer` already provides `PtyEnvironment.defaultLayer` (the
   * empty overlay — see `src/pty/index.ts:315`). It does NOT provide
   * `Plugin.defaultLayer`; that lives one level up at
   * `PluginPtyEnvironment.ptyLayer`. The standalone-server / unit-test path
   * uses this layer; production wires through `PluginPtyEnvironment.ptyLayer`
   * in the `layer` export below.
   */
  export const DependenciesLive = Pty.defaultLayer

  /**
   * Production-grade layer: same surface as `PtyRoutes` in `routes/pty.ts`.
   * Consumers that need the plugin-aware env overlay should use this layer
   * instead of `DependenciesLive`.
   */
  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(PluginPtyEnvironment.ptyLayer))
}
