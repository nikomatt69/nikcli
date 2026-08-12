import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Bus } from "@/bus"
import { generateFromDescription } from "@/loop/generate"
import * as Engine from "@/loop/engine"
import * as Manager from "@/loop/manager"
import { LOOP_TEMPLATES, generateID, validateDefinition, type LoopDefinition } from "@/loop/schema"
import * as Domain from "./domain"

export namespace LoopHttpApi {
  const BooleanResult = Schema.Boolean.annotate({
    identifier: "LoopBooleanResult",
  })

  /**
   * Domain schemas live in `./domain` so the mobile contract can describe the
   * same loop objects without importing the loop engine.
   */
  const ListOutput = Schema.Struct({
    loops: Schema.Array(Domain.LoopDefinition),
    runtimes: Schema.Array(Domain.LoopRuntime),
  }).annotate({ identifier: "LoopListOutput" })

  const TemplatesOutput = Schema.Struct({
    templates: Schema.Array(Domain.LoopTemplate),
  }).annotate({ identifier: "LoopTemplatesOutput" })

  const RunsOutput = Schema.Struct({ runs: Schema.Array(Domain.LoopRun) }).annotate({ identifier: "LoopRunsOutput" })

  const GetOutput = Schema.Struct({
    loop: Domain.LoopDefinition,
    runtime: Domain.LoopRuntime,
  }).annotate({ identifier: "LoopGetOutput" })

  const NotFound = Schema.Struct({
    name: Schema.Literal("NotFound"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "LoopNotFound", httpApiStatus: 404 })

  const ValidationError = Schema.Struct({
    name: Schema.Literal("ValidationError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "LoopValidationError", httpApiStatus: 400 })

  type NotFoundBody = typeof NotFound.Type
  type ValidationErrorBody = typeof ValidationError.Type

  const failNotFound = (message: string): Effect.Effect<never, NotFoundBody> =>
    Effect.fail({ name: "NotFound" as const, data: { message } })

  const failValidation = (message: string): Effect.Effect<never, ValidationErrorBody> =>
    Effect.fail({ name: "ValidationError" as const, data: { message } })

  const fromPromise = <A>(fn: () => Promise<A>) => Effect.promise(fn).pipe(Effect.orDie)

  const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

  const LoopIDPath = Schema.Struct({ id: Schema.String })

  const RunsQuery = Schema.Struct({
    limit: Schema.optional(Schema.NumberFromString),
  })

  const RecentRunsQuery = Schema.Struct({
    limit: Schema.optional(Schema.NumberFromString),
  })

  const TogglePayload = Schema.Struct({
    enabled: Schema.Boolean,
  }).annotate({ identifier: "LoopToggleInput" })

  const GeneratePayload = Schema.Struct({
    description: Schema.String,
    model: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
  }).annotate({ identifier: "LoopGenerateInput" })

  /** Create body: full definition minus server-assigned id/createdAt. */
  const CreatePayload = Schema.Unknown.annotate({
    identifier: "LoopCreateInput",
  })
  const UpdatePayload = Schema.Unknown.annotate({
    identifier: "LoopUpdateInput",
  })

  export const Group = HttpApiGroup.make("loop")
    .add(HttpApiEndpoint.get("list", "/", { success: ListOutput }))
    .add(HttpApiEndpoint.get("templates", "/templates", { success: TemplatesOutput }))
    .add(
      HttpApiEndpoint.post("generate", "/generate", {
        payload: GeneratePayload,
        success: Domain.LoopDefinition,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.get("recentRuns", "/runs/recent", {
        query: RecentRunsQuery,
        success: RunsOutput,
      }),
    )
    .add(
      HttpApiEndpoint.get("get", "/:id", {
        params: LoopIDPath,
        success: GetOutput,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.put("upsert", "/", {
        payload: CreatePayload,
        success: Domain.LoopDefinition,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("update", "/:id", {
        params: LoopIDPath,
        payload: UpdatePayload,
        success: Domain.LoopDefinition,
        error: [NotFound, ValidationError],
      }),
    )
    .add(
      HttpApiEndpoint.delete("remove", "/:id", {
        params: LoopIDPath,
        success: BooleanResult,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "loop.delete"),
    )
    .add(
      HttpApiEndpoint.post("toggle", "/:id/toggle", {
        params: LoopIDPath,
        payload: TogglePayload,
        success: Domain.LoopDefinition,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("run", "/:id/run", {
        params: LoopIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("abort", "/:id/abort", {
        params: LoopIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("pause", "/:id/pause", {
        params: LoopIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("resume", "/:id/resume", {
        params: LoopIDPath,
        success: BooleanResult,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.get("runs", "/:id/runs", {
        params: LoopIDPath,
        query: RunsQuery,
        success: RunsOutput,
      }),
    )
    .prefix("/loop")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    list: () =>
      fromPromise(async () => {
        const loops = await Manager.list()
        const runtimes = loops.map((loop) => ({
          loopID: loop.id,
          ...Engine.getRuntime(loop.id),
        }))
        return jsonSafe({ loops, runtimes })
      }),

    templates: () => Effect.succeed(jsonSafe({ templates: LOOP_TEMPLATES })),

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

    recentRuns: ({ query }: { query: typeof RecentRunsQuery.Type }) =>
      fromPromise(async () => {
        const limit = query.limit ?? 100
        const runs = await Manager.listAllRunsAcrossLoops(limit)
        return jsonSafe({ runs })
      }),

    get: ({ params }: { params: { id: string } }) =>
      fromPromise(async () => {
        const loop = await Manager.get(params.id)
        if (!loop) return { notFound: true as const, id: params.id }
        return {
          notFound: false as const,
          body: jsonSafe({
            loop,
            runtime: { loopID: params.id, ...Engine.getRuntime(params.id) },
          }),
        }
      }).pipe(
        Effect.flatMap((result) =>
          result.notFound ? failNotFound(`Loop "${result.id}" not found`) : Effect.succeed(result.body),
        ),
      ),

    upsert: ({ payload }: { payload: unknown }) =>
      Effect.gen(function* () {
        const body = payload as Omit<LoopDefinition, "id" | "createdAt">
        const id = generateID()
        const def: LoopDefinition = {
          ...body,
          id,
          createdAt: Date.now(),
          enabled: body.enabled ?? true,
        } as LoopDefinition
        const err = validateDefinition(def)
        if (err) return yield* failValidation(err)
        const saved = yield* fromPromise(() => Manager.upsert(def))
        yield* fromPromise(() => Engine.sync(saved.id))
        yield* Effect.promise(() => Bus.publish(Engine.LoopEvent.Upserted, { loopID: saved.id }))
        return jsonSafe(saved)
      }),

    update: ({ params, payload }: { params: { id: string }; payload: unknown }) =>
      Effect.gen(function* () {
        const body = payload as LoopDefinition
        if (body.id !== params.id) {
          return yield* failValidation("Path id and body id do not match")
        }
        const err = validateDefinition(body)
        if (err) return yield* failValidation(err)
        const existing = yield* fromPromise(() => Manager.get(params.id))
        if (!existing) return yield* failNotFound(`Loop "${params.id}" not found`)
        const saved = yield* fromPromise(() => Manager.upsert(body))
        if (saved.maxRuns !== existing.maxRuns) {
          yield* fromPromise(() => Engine.resetRunCount(saved.id))
        }
        yield* fromPromise(() => Engine.sync(saved.id))
        yield* Effect.promise(() => Bus.publish(Engine.LoopEvent.Upserted, { loopID: saved.id }))
        return jsonSafe(saved)
      }),

    remove: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Loop "${params.id}" not found`)
        yield* fromPromise(() => Engine.cancelRun(params.id).catch(() => undefined))
        const removed = yield* fromPromise(() => Manager.remove(params.id))
        if (!removed) return yield* failNotFound(`Loop "${params.id}" not found`)
        Engine.disarm(params.id)
        yield* Effect.promise(() => Bus.publish(Engine.LoopEvent.Removed, { loopID: params.id }))
        return true
      }),

    toggle: ({ params, payload }: { params: { id: string }; payload: typeof TogglePayload.Type }) =>
      Effect.gen(function* () {
        const next = yield* fromPromise(() => Manager.setEnabled(params.id, payload.enabled))
        if (!next) return yield* failNotFound(`Loop "${params.id}" not found`)
        yield* fromPromise(() => Engine.sync(params.id))
        yield* Effect.promise(() => Bus.publish(Engine.LoopEvent.Upserted, { loopID: params.id }))
        return jsonSafe(next)
      }),

    run: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Loop "${params.id}" not found`)
        void Engine.runOnce(params.id)
        return true
      }),

    abort: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Loop "${params.id}" not found`)
        yield* fromPromise(() => Engine.cancelRun(params.id))
        return true
      }),

    pause: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.setPaused(params.id, true))
        if (!def) return yield* failNotFound(`Loop "${params.id}" not found`)
        Engine.disarm(params.id)
        Engine.setRuntimeStatus(params.id, "paused")
        return true
      }),

    resume: ({ params }: { params: { id: string } }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.setPaused(params.id, false))
        if (!def) return yield* failNotFound(`Loop "${params.id}" not found`)
        Engine.setRuntimeStatus(params.id, "idle")
        yield* fromPromise(() => Engine.sync(params.id))
        return true
      }),

    runs: ({ params, query }: { params: { id: string }; query: typeof RunsQuery.Type }) =>
      fromPromise(async () => {
        const runs = await Manager.listRuns(params.id, query.limit ?? 50)
        return jsonSafe({ runs })
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "loop", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("templates", handlers.templates)
      .handle("generate", handlers.generate)
      .handle("recentRuns", handlers.recentRuns)
      .handle("get", handlers.get)
      .handle("upsert", handlers.upsert)
      .handle("update", handlers.update)
      .handle("remove", handlers.remove)
      .handle("toggle", handlers.toggle)
      .handle("run", handlers.run)
      .handle("abort", handlers.abort)
      .handle("pause", handlers.pause)
      .handle("resume", handlers.resume)
      .handle("runs", handlers.runs),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
