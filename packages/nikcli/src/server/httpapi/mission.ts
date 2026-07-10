import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Bus } from "@/bus"
import { generateFromDescription } from "@/mission/generate"
import * as Engine from "@/mission/orchestrator"
import * as Manager from "@/mission/manager"
import {
  generateID,
  validateDefinition,
  MISSION_TEMPLATES,
  MissionDefinitionSchema,
  type MissionDefinition,
} from "@/mission/schema"
import { Log } from "@/util/log"

export namespace MissionHttpApi {
  const log = Log.create({ service: "httpapi.mission" })

  const BooleanResult = Schema.Boolean.annotate({
    identifier: "MissionBooleanResult",
  })
  const UnknownJson = Schema.Unknown

  const NotFound = Schema.Struct({
    name: Schema.Literal("NotFound"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "MissionNotFound", httpApiStatus: 404 })

  const ValidationError = Schema.Struct({
    name: Schema.Literal("ValidationError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "MissionValidationError", httpApiStatus: 400 })

  type NotFoundBody = typeof NotFound.Type
  type ValidationErrorBody = typeof ValidationError.Type

  const failNotFound = (message: string): Effect.Effect<never, NotFoundBody> =>
    Effect.fail({ name: "NotFound" as const, data: { message } })

  const failValidation = (message: string): Effect.Effect<never, ValidationErrorBody> =>
    Effect.fail({ name: "ValidationError" as const, data: { message } })

  const fromPromise = <A>(fn: () => Promise<A>) => Effect.promise(fn).pipe(Effect.orDie)

  const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

  const MissionIDPath = Schema.Struct({ id: Schema.String })

  const FeaturePath = Schema.Struct({
    id: Schema.String,
    featureID: Schema.String,
  })

  const ExecsQuery = Schema.Struct({
    limit: Schema.optional(Schema.NumberFromString),
  })

  const GeneratePayload = Schema.Struct({
    description: Schema.String,
    model: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
  }).annotate({ identifier: "MissionGenerateInput" })

  /** Create body: full definition minus server-assigned id/createdAt/status. */
  const CreatePayload = Schema.Unknown.annotate({
    identifier: "MissionCreateInput",
  })
  const UpdatePayload = Schema.Unknown.annotate({
    identifier: "MissionUpdateInput",
  })

  // The legacy Hono route validates bodies with these zod schemas, which also
  // apply schema defaults (feature status, milestone validation policy, …).
  // Parse with the same schemas so persisted shapes stay identical.
  const CreateInputZod = MissionDefinitionSchema.omit({
    id: true,
    createdAt: true,
    status: true,
  })
  const UpdateInputZod = MissionDefinitionSchema

  const FeatureMutatePayload = Schema.Struct({
    status: Schema.optional(Schema.Literals(["pending", "running", "done", "blocked", "skipped", "error"])),
    error: Schema.optional(Schema.String),
    appendDependsOn: Schema.optional(Schema.Array(Schema.String)),
  }).annotate({ identifier: "MissionFeatureMutateInput" })

  export const Group = HttpApiGroup.make("mission")
    .add(HttpApiEndpoint.get("list", "/", { success: UnknownJson }))
    .add(HttpApiEndpoint.get("templates", "/templates", { success: UnknownJson }))
    .add(
      HttpApiEndpoint.post("generate", "/generate", {
        payload: GeneratePayload,
        success: UnknownJson,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.get("recentExecs", "/execs/recent", {
        query: ExecsQuery,
        success: UnknownJson,
      }),
    )
    .add(
      HttpApiEndpoint.get("get", "/:id", {
        params: MissionIDPath,
        success: UnknownJson,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.put("upsert", "/", {
        payload: CreatePayload,
        success: UnknownJson,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("update", "/:id", {
        params: MissionIDPath,
        payload: UpdatePayload,
        success: UnknownJson,
        error: [NotFound, ValidationError],
      }),
    )
    .add(
      HttpApiEndpoint.delete("remove", "/:id", {
        params: MissionIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("start", "/:id/start", {
        params: MissionIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("pause", "/:id/pause", {
        params: MissionIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("cancel", "/:id/cancel", {
        params: MissionIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("featureMutate", "/:id/feature/:featureID", {
        params: FeaturePath,
        payload: FeatureMutatePayload,
        success: UnknownJson,
        error: [NotFound, ValidationError],
      }),
    )
    .add(
      HttpApiEndpoint.get("execs", "/:id/execs", {
        params: MissionIDPath,
        query: ExecsQuery,
        success: UnknownJson,
      }),
    )
    .prefix("/mission")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  const publishUpserted = (missionID: string) =>
    Effect.sync(() => {
      void Bus.publish(Engine.MissionEvent.Upserted, { missionID })
    })

  export const handlers = {
    list: () =>
      fromPromise(async () => {
        const missions = await Manager.list()
        const runtimes = missions.map((m) => ({
          missionID: m.id,
          ...Engine.getRuntime(m.id),
        }))
        return jsonSafe({ missions, runtimes })
      }),

    templates: () => Effect.succeed(jsonSafe({ templates: MISSION_TEMPLATES })),

    generate: ({ payload }: { payload: typeof GeneratePayload.Type }) =>
      fromPromise(() =>
        generateFromDescription(payload.description, {
          model: payload.model,
          agent: payload.agent,
        }).then(jsonSafe),
      ).pipe(
        Effect.catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          return failValidation(message)
        }),
      ),

    get: ({ params }: { params: { id: string } }) =>
      fromPromise(async () => {
        const mission = await Manager.get(params.id)
        if (!mission) return { notFound: true as const, id: params.id }
        return {
          notFound: false as const,
          body: jsonSafe({
            mission,
            runtime: { missionID: params.id, ...Engine.getRuntime(params.id) },
          }),
        }
      }).pipe(
        Effect.flatMap((result) =>
          result.notFound ? failNotFound(`Mission "${result.id}" not found`) : Effect.succeed(result.body),
        ),
      ),

    upsert: ({ payload }: { payload: unknown }) =>
      Effect.gen(function* () {
        const parsed = CreateInputZod.safeParse(payload)
        if (!parsed.success) {
          return yield* failValidation(parsed.error.issues[0]?.message ?? "Invalid mission definition")
        }
        const body = parsed.data
        const def: MissionDefinition = {
          ...body,
          id: generateID(),
          status: "ready",
          createdAt: Date.now(),
          models: body.models ?? {},
        }
        const err = validateDefinition(def)
        if (err) return yield* failValidation(err)
        const saved = yield* fromPromise(() => Manager.upsert(def))
        yield* publishUpserted(saved.id)
        return jsonSafe(saved)
      }),

    update: ({ params, payload }: { params: { id: string }; payload: unknown }) =>
      Effect.gen(function* () {
        const parsed = UpdateInputZod.safeParse(payload)
        if (!parsed.success) {
          return yield* failValidation(parsed.error.issues[0]?.message ?? "Invalid mission definition")
        }
        const body = parsed.data
        if (body.id !== params.id) {
          return yield* failValidation("Path id and body id do not match")
        }
        const err = validateDefinition(body)
        if (err) return yield* failValidation(err)
        const existing = yield* fromPromise(() => Manager.get(params.id))
        if (!existing) return yield* failNotFound(`Mission "${params.id}" not found`)
        const saved = yield* fromPromise(() => Manager.upsert(body))
        yield* publishUpserted(saved.id)
        return jsonSafe(saved)
      }),

    remove: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Mission "${params.id}" not found`)
        // Cancel any in-flight orchestration *before* removing the definition
        // so no orphan `MissionExec` is written for a mission the user just
        // deleted.
        yield* fromPromise(() =>
          Engine.cancel(params.id).catch((error) => {
            log.warn("cancel on delete failed", { id: params.id, error })
          }),
        )
        const removed = yield* fromPromise(() => Manager.remove(params.id))
        if (!removed) return yield* failNotFound(`Mission "${params.id}" not found`)
        yield* Effect.sync(() => {
          void Bus.publish(Engine.MissionEvent.Removed, { missionID: params.id })
        })
        return true
      }),

    start: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Mission "${params.id}" not found`)
        void Engine.start(params.id)
        return true
      }),

    pause: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Mission "${params.id}" not found`)
        yield* fromPromise(() => Engine.pause(params.id))
        return true
      }),

    cancel: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Mission "${params.id}" not found`)
        yield* fromPromise(() => Engine.cancel(params.id))
        return true
      }),

    featureMutate: ({
      params,
      payload,
    }: {
      params: { id: string; featureID: string }
      payload: typeof FeatureMutatePayload.Type
    }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Mission "${params.id}" not found`)
        let found = false
        const milestones = def.milestones.map((m) => ({
          ...m,
          features: m.features.map((f) => {
            if (f.id !== params.featureID) return f
            found = true
            const next: typeof f = { ...f }
            if (payload.status !== undefined) next.status = payload.status
            if (payload.status === "done") next.error = undefined
            if (payload.error !== undefined) next.error = payload.error
            if (payload.appendDependsOn && payload.appendDependsOn.length > 0) {
              const known = new Set(m.features.map((ff) => ff.id))
              const extras = payload.appendDependsOn.filter(
                (d) => known.has(d) && d !== next.id && !next.dependsOn.includes(d),
              )
              next.dependsOn = [...next.dependsOn, ...extras]
            }
            return next
          }),
        }))
        if (!found) return yield* failNotFound(`Feature "${params.featureID}" not found`)
        const updated: MissionDefinition = { ...def, milestones }
        const err = validateDefinition(updated)
        if (err) return yield* failValidation(err)
        const saved = yield* fromPromise(() => Manager.upsert(updated))
        yield* publishUpserted(saved.id)
        return jsonSafe(saved)
      }),

    execs: ({ params, query }: { params: { id: string }; query: typeof ExecsQuery.Type }) =>
      fromPromise(async () => {
        const execs = await Manager.listExecs(params.id, query.limit ?? 100)
        return jsonSafe({ execs })
      }),

    recentExecs: ({ query }: { query: typeof ExecsQuery.Type }) =>
      fromPromise(async () => {
        const records = await Manager.listRunningExecs()
        return jsonSafe({ execs: records.slice(0, query.limit ?? 100) })
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "mission", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("templates", handlers.templates)
      .handle("generate", handlers.generate)
      .handle("recentExecs", handlers.recentExecs)
      .handle("get", handlers.get)
      .handle("upsert", handlers.upsert)
      .handle("update", handlers.update)
      .handle("remove", handlers.remove)
      .handle("start", handlers.start)
      .handle("pause", handlers.pause)
      .handle("cancel", handlers.cancel)
      .handle("featureMutate", handlers.featureMutate)
      .handle("execs", handlers.execs),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
