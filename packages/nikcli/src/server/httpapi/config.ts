import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { mapValues } from "remeda"
import { fromZod } from "@/util/zod-effect"

export namespace ConfigHttpApi {
  /**
   * The whole `nikcli.json` document, derived from the zod schema that actually
   * validates the file (`Config.Info`) rather than hand-copied — see
   * `util/zod-effect.ts`. Its `.meta({ ref })` annotations carry through, so the
   * generated clients get `KeybindsConfig`, `McpLocalConfig`, `ReferenceConfig`
   * and friends as named types.
   */
  export const Info = Schema.StructWithRest(fromZod(Config.Info) as unknown as Schema.Struct<Schema.Struct.Fields>, [
    // The document keeps an open tail. Two reasons: forward compatibility with
    // a client on a newer config schema, and the codegen writes a struct
    // payload once per field it contributes — which for a document this size
    // means repeating the whole type dozens of times. An index signature makes
    // it one opaque payload input (`{ payload: Config }`) while every declared
    // field stays precisely typed.
    Schema.Record(Schema.String, Schema.Unknown),
  ]).annotate({ identifier: "Config" })

  export const ProviderInfo = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    source: Schema.Literals(["env", "config", "custom", "api"]),
    env: Schema.Array(Schema.String),
    key: Schema.optional(Schema.String),
    options: Schema.Record(Schema.String, Schema.Unknown),
    models: Schema.Record(Schema.String, Provider.ModelSchema),
  }).annotate({ identifier: "Provider" })

  export const ProviderSummary = Schema.Struct({
    providers: Schema.Array(ProviderInfo),
    default: Schema.Record(Schema.String, Schema.String),
  }).annotate({ identifier: "ConfigProviders" })

  /**
   * Declared 400 for config writes that fail on an invalid or unparsable
   * existing config file. Body mirrors the legacy `{ name, data }` error
   * contract (`ConfigJsonError` / `ConfigInvalidError`), so the SDK shape
   * is identical to the Hono error chain — but declared on the endpoint
   * instead of synthesized by a catch-all.
   */
  export const UpdateError = Schema.Struct({
    name: Schema.String,
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "ConfigUpdateError", httpApiStatus: 400 })

  export const Group = HttpApiGroup.make("config")
    .add(HttpApiEndpoint.get("get", "/", { success: Info }))
    .add(
      HttpApiEndpoint.patch("update", "/", {
        payload: Info,
        success: Info,
        error: UpdateError,
      }),
    )
    .add(
      HttpApiEndpoint.get("providers", "/providers", {
        success: ProviderSummary,
      }),
    )
    .prefix("/config")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  // Runtime config/provider objects carry `undefined` optional fields (e.g.
  // agent `steps`, model cost `experimentalOver200K`) which the HttpApi JSON
  // encoder rejects; Hono's JSON.stringify silently dropped them.
  const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

  function asUpdateError(cause: unknown) {
    if (cause instanceof Config.JsonError || cause instanceof Config.InvalidError) {
      const { _tag: _ignored, ...data } = cause
      return Effect.fail({
        name: cause._tag,
        data: { ...data } as Record<string, unknown>,
      })
    }
    return Effect.die(cause)
  }

  export const handlers = {
    get: () =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        return jsonSafe(yield* config.get())
      }).pipe(Effect.orDie),
    update: ({ payload }: { payload: typeof Info.Type }) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.update(payload as Config.Info)
        yield* Effect.promise(() => Instance.dispose())
        return payload
      }).pipe(
        // failures first — converting defects afterwards keeps the converted
        // failure from being re-killed by the failure handler
        Effect.catch(asUpdateError),
        // Config.Service.update wraps the async impl with Effect.promise, so
        // ConfigJsonError / ConfigInvalidError arrive as defects, not failures
        Effect.catchDefect(asUpdateError),
      ),
    providers: () =>
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        return jsonSafe({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "config", (builder) =>
    builder.handle("get", handlers.get).handle("update", handlers.update).handle("providers", handlers.providers),
  )

  export const DependenciesLive = Layer.mergeAll(Config.defaultLayer, Provider.defaultLayer)

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
