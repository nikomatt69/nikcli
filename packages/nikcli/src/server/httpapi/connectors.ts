import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Connectors } from "@/connectors"
import { ConnectorAuth } from "@/connectors/auth"

export namespace ConnectorsHttpApi {
  const UnknownJson = Schema.Unknown

  const Success = Schema.Struct({
    success: Schema.Literal(true),
  }).annotate({ identifier: "ConnectorsSuccess" })

  /** Mirrors the legacy zod refine: at least one credential field required. */
  const AuthError = Schema.Struct({
    name: Schema.Literal("ValidationError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "ConnectorsValidationError", httpApiStatus: 400 })

  type AuthErrorBody = typeof AuthError.Type

  const NamePath = Schema.Struct({ name: Schema.String })

  const AuthPayload = Schema.Unknown.annotate({ identifier: "ConnectorsAuthInput" })

  const InvalidatePayload = Schema.Struct({
    name: Schema.optional(Schema.String),
  }).annotate({ identifier: "ConnectorsInvalidateInput" })

  const fromPromise = <A>(fn: () => Promise<A>) => Effect.promise(fn).pipe(Effect.orDie)

  export const Group = HttpApiGroup.make("connectors")
    .add(HttpApiEndpoint.get("status", "/", { success: UnknownJson }))
    .add(
      HttpApiEndpoint.post("authSet", "/:name/auth", {
        params: NamePath,
        payload: AuthPayload,
        success: Success,
        error: AuthError,
      }),
    )
    .add(
      HttpApiEndpoint.delete("authRemove", "/:name/auth", {
        params: NamePath,
        success: Success,
      }),
    )
    .add(
      HttpApiEndpoint.post("invalidate", "/invalidate", {
        payload: InvalidatePayload,
        success: Success,
      }),
    )
    .prefix("/connectors")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  // Same shape the legacy Hono validator enforced through `.refine(...)`.
  const AuthInputZod = ConnectorAuth.Entry.refine(
    (value) => !!(value.token || value.botToken || value.apiKey),
    "Provide at least one credential field.",
  )

  export const handlers = {
    status: () => fromPromise(() => Connectors.status()),

    authSet: ({ params, payload }: { params: { name: string }; payload: unknown }) =>
      Effect.gen(function* () {
        const parsed = AuthInputZod.safeParse(payload)
        if (!parsed.success) {
          return yield* Effect.fail<AuthErrorBody>({
            name: "ValidationError",
            data: { message: parsed.error.issues[0]?.message ?? "Invalid credentials" },
          })
        }
        const auth = yield* ConnectorAuth.Service
        const existing = yield* auth.get(params.name).pipe(Effect.orDie)
        yield* auth.set(params.name, { ...existing, ...parsed.data }).pipe(Effect.orDie)
        Connectors.invalidateConnector(params.name)
        return { success: true as const }
      }),

    authRemove: ({ params }: { params: { name: string } }) =>
      Effect.gen(function* () {
        const auth = yield* ConnectorAuth.Service
        yield* auth.remove(params.name).pipe(Effect.orDie)
        Connectors.invalidateConnector(params.name)
        return { success: true as const }
      }),

    invalidate: ({ payload }: { payload: typeof InvalidatePayload.Type }) =>
      Effect.sync(() => {
        if (payload.name) {
          Connectors.invalidateConnector(payload.name)
        } else {
          Connectors.invalidateStatus()
          Connectors.invalidateTools()
        }
        return { success: true as const }
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "connectors", (builder) =>
    builder
      .handle("status", handlers.status)
      .handle("authSet", handlers.authSet)
      .handle("authRemove", handlers.authRemove)
      .handle("invalidate", handlers.invalidate),
  )

  export const DependenciesLive = ConnectorAuth.defaultLayer

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
