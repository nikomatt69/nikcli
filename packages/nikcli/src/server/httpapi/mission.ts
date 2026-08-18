import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
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
import { Log } from "@nikcli-ai/util/log"
import { fromZod } from "@/util/zod-effect"

export namespace MissionHttpApi {
  const log = Log.create({ service: "httpapi.mission" })

  const BooleanResult = Schema.Boolean.annotate({
    identifier: "MissionBooleanResult",
  })
  /**
   * Mirrors the zod schemas in `@/mission/schema` and the runtime shape in
   * `@/mission/orchestrator`. Declared as Effect Schemas so the generated
   * clients carry real types instead of `any`. Optional fields use
   * `Schema.optionalKey` so a present `undefined` is encoded as an absent
   * key — same JSON wire as before, no `JSON.parse(JSON.stringify(...))`
   * round-trip.
   */
  const MissionFeature = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    objective: Schema.String,
    agent: Schema.String,
    model: Schema.optionalKey(Schema.String),
    tokenBudget: Schema.optionalKey(Schema.Number),
    dependsOn: Schema.Array(Schema.String),
    status: Schema.Literals(["pending", "running", "done", "blocked", "skipped", "error"]),
    error: Schema.optionalKey(Schema.String),
  }).annotate({ identifier: "MissionFeature" })

  const MissionMilestone = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    features: Schema.Array(MissionFeature),
    validation: Schema.Literals(["scrutiny", "user-test", "none"]),
    status: Schema.Literals(["pending", "running", "validating", "done", "blocked"]),
  }).annotate({ identifier: "MissionMilestone" })

  const MissionModels = Schema.Struct({
    worker: Schema.optionalKey(Schema.String),
    validation: Schema.optionalKey(Schema.String),
    orchestrator: Schema.optionalKey(Schema.String),
  }).annotate({ identifier: "MissionModels" })

  const MissionWorktree = Schema.Struct({
    name: Schema.String,
    branch: Schema.optionalKey(Schema.String),
    directory: Schema.String,
  }).annotate({ identifier: "MissionWorktree" })

  const MissionDefinitionOutput = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    brief: Schema.String,
    milestones: Schema.Array(MissionMilestone),
    models: MissionModels,
    timeoutMs: Schema.optionalKey(Schema.Number),
    sandbox: Schema.optionalKey(Schema.Boolean),
    worktree: Schema.optionalKey(MissionWorktree),
    status: Schema.Literals(["planning", "ready", "running", "paused", "frozen", "complete", "error"]),
    createdAt: Schema.Number,
  }).annotate({ identifier: "MissionDefinition" })

  const MissionExecSchema = Schema.Struct({
    id: Schema.String,
    missionID: Schema.String,
    kind: Schema.Literals(["feature", "validation"]),
    targetID: Schema.String,
    targetName: Schema.String,
    startedAt: Schema.Number,
    endedAt: Schema.optionalKey(Schema.Number),
    status: Schema.Literals(["running", "complete", "error", "timeout", "cancelled", "orphaned"]),
    heartbeatAt: Schema.optionalKey(Schema.Number),
    sessionID: Schema.optionalKey(Schema.String),
    error: Schema.optionalKey(Schema.String),
    ok: Schema.Boolean,
  }).annotate({ identifier: "MissionExec" })

  /** `Engine.getRuntime()` merged with the mission id the handlers attach. */
  const MissionRuntime = Schema.Struct({
    missionID: Schema.String,
    status: Schema.Literals(["idle", "running", "paused", "error", "cancelling"]),
    sessionID: Schema.optionalKey(Schema.String),
    currentMilestoneID: Schema.optionalKey(Schema.String),
    currentFeatureID: Schema.optionalKey(Schema.String),
    doneFeatures: Schema.Number,
    totalFeatures: Schema.Number,
    lastError: Schema.optionalKey(Schema.String),
    lastRunAt: Schema.optionalKey(Schema.Number),
  }).annotate({ identifier: "MissionRuntime" })

  const MissionTemplateSchema = Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.String,
    brief: Schema.String,
  }).annotate({ identifier: "MissionTemplate" })

  const ListOutput = Schema.Struct({
    missions: Schema.Array(MissionDefinitionOutput),
    runtimes: Schema.Array(MissionRuntime),
  }).annotate({ identifier: "MissionListOutput" })

  const TemplatesOutput = Schema.Struct({
    templates: Schema.Array(MissionTemplateSchema),
  }).annotate({ identifier: "MissionTemplatesOutput" })

  const GetOutput = Schema.Struct({
    mission: MissionDefinitionOutput,
    runtime: MissionRuntime,
  }).annotate({ identifier: "MissionGetOutput" })

  const ExecsOutput = Schema.Struct({ execs: Schema.Array(MissionExecSchema) }).annotate({
    identifier: "MissionExecsOutput",
  })

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

  /**
   * `Manager.upsert` throws when `sanitizeDefinition` rejects the definition.
   * The handlers re-run `validateDefinition` first, but not the zod
   * `MissionDefinitionSchema.safeParse` that `sanitizeDefinition` runs ahead
   * of it. `create`/`update` already run that same parse in the handler, so
   * this is unreachable from them today; `featureMutate` does not, and either
   * way a rejected definition is a client input error that belongs on the 400
   * all three routes declare, not on the defect channel. The loop slice has
   * the same helper for a path that *is* reachable (see httpapi-loop.test.ts).
   */
  const upsertDefinition = (def: MissionDefinition): Effect.Effect<MissionDefinition, ValidationErrorBody> =>
    Effect.tryPromise({
      try: () => Manager.upsert(def),
      catch: (cause) => ({
        name: "ValidationError" as const,
        data: { message: cause instanceof Error ? cause.message : String(cause) } as Record<string, unknown>,
      }),
    })

  const MissionIDPath = Schema.Struct({ id: Schema.String })

  const FeaturePath = Schema.Struct({
    id: Schema.String,
    featureID: Schema.String,
  })

  const ExecsQuery = Schema.Struct({
    limit: Schema.optionalKey(Schema.NumberFromString),
  })

  const GeneratePayload = Schema.Struct({
    description: Schema.String,
    model: Schema.optionalKey(Schema.String),
    agent: Schema.optionalKey(Schema.String),
    /**
     * The session the request was launched from. Absent `model`, the drafting
     * call inherits this session's model instead of the global default — the
     * one the user has selected in front of them.
     */
    sessionID: Schema.optionalKey(Schema.String),
  }).annotate({ identifier: "MissionGenerateInput" })

  // These zod schemas validate bodies and apply schema defaults (feature
  // status, milestone validation policy, …). The handlers still parse with
  // them, so persisted shapes stay identical.
  const CreateInputZod = MissionDefinitionSchema.omit({
    id: true,
    createdAt: true,
    status: true,
  })
  const UpdateInputZod = MissionDefinitionSchema

  /**
   * Create body: full definition minus server-assigned id/createdAt/status.
   *
   * Derived from the very zod schema the handler parses with, rather than
   * restated in Effect. A hand-written copy would be a second definition of a
   * shape that already has defaults, refinements and a milestone policy baked
   * in, and the two would drift silently — the contract would advertise one
   * body while the handler accepted another.
   *
   * `fromZod` maps `.default(x)` to optional, which is what a create body
   * actually is: the default is applied by the zod parse afterwards, so the
   * contract must not demand the field up front.
   */
  const CreatePayload = fromZod(CreateInputZod).annotate({
    identifier: "MissionCreateInput",
  })
  /**
   * Update body: the definition except `id`, which the path already carries.
   *
   * The generated clients flatten path params and body fields into one argument
   * object, so a body `id` beside `/:id` is a field collision the codegen
   * rejects. The handler puts the path id back before parsing, so what reaches
   * `Manager.upsert` is unchanged.
   */
  const UpdatePayload = fromZod(UpdateInputZod.omit({ id: true })).annotate({
    identifier: "MissionUpdateInput",
  })

  const FeatureMutatePayload = Schema.Struct({
    status: Schema.optional(Schema.Literals(["pending", "running", "done", "blocked", "skipped", "error"])),
    error: Schema.optional(Schema.String),
    appendDependsOn: Schema.optional(Schema.Array(Schema.String)),
  }).annotate({ identifier: "MissionFeatureMutateInput" })

  /**
   * Optional body for `POST /mission/:id/start`. Carries the session that
   * fired the start, so the freshly-created mission session can inherit that
   * session's last-used model instead of falling back to the global provider
   * default.
   */
  const StartPayload = Schema.Struct({
    sessionID: Schema.optional(Schema.String),
  }).annotate({ identifier: "MissionStartInput" })

  export const Group = HttpApiGroup.make("mission")
    .add(HttpApiEndpoint.get("list", "/", { success: ListOutput }))
    .add(HttpApiEndpoint.get("templates", "/templates", { success: TemplatesOutput }))
    .add(
      HttpApiEndpoint.post("generate", "/generate", {
        payload: GeneratePayload,
        success: MissionDefinitionOutput,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.get("recentExecs", "/execs/recent", {
        query: ExecsQuery,
        success: ExecsOutput,
      }),
    )
    .add(
      HttpApiEndpoint.get("get", "/:id", {
        params: MissionIDPath,
        success: GetOutput,
        error: NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.put("upsert", "/", {
        payload: CreatePayload,
        success: MissionDefinitionOutput,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("update", "/:id", {
        params: MissionIDPath,
        payload: UpdatePayload,
        success: MissionDefinitionOutput,
        error: [NotFound, ValidationError],
      }),
    )
    .add(
      HttpApiEndpoint.delete("remove", "/:id", {
        params: MissionIDPath,
        success: BooleanResult,
        error: NotFound,
      }).annotate(OpenApi.Identifier, "mission.delete"),
    )
    .add(
      HttpApiEndpoint.post("start", "/:id/start", {
        params: MissionIDPath,
        // The body is optional — the handler reads `payload?.sessionID`, and the
        // lifecycle routes are called without one. Declaring the payload bare
        // made a bodyless POST fail the request decode with an empty 400
        // before the handler could answer 404.
        payload: [HttpApiSchema.NoContent, StartPayload],
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
        success: MissionDefinitionOutput,
        error: [NotFound, ValidationError],
      }).annotate(OpenApi.Identifier, "mission.feature.mutate"),
    )
    .add(
      HttpApiEndpoint.get("execs", "/:id/execs", {
        params: MissionIDPath,
        query: ExecsQuery,
        success: ExecsOutput,
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
        return { missions, runtimes }
      }),

    templates: () => Effect.succeed({ templates: MISSION_TEMPLATES }),

    generate: ({ payload }: { payload: typeof GeneratePayload.Type }) =>
      fromPromise(() =>
        generateFromDescription(payload.description, {
          model: payload.model,
          agent: payload.agent,
          sessionID: payload.sessionID,
        }),
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
          body: {
            mission,
            runtime: { missionID: params.id, ...Engine.getRuntime(params.id) },
          },
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
        const saved = yield* upsertDefinition(def)
        yield* publishUpserted(saved.id)
        return saved
      }),

    update: ({ params, payload }: { params: { id: string }; payload: unknown }) =>
      Effect.gen(function* () {
        // The path is the identity: put it back before parsing, so the zod
        // schema (and its defaults) still see a whole definition. The old
        // "path id and body id do not match" check is gone because the body can
        // no longer carry an id to disagree with.
        const parsed = UpdateInputZod.safeParse({ ...(payload as Record<string, unknown>), id: params.id })
        if (!parsed.success) {
          return yield* failValidation(parsed.error.issues[0]?.message ?? "Invalid mission definition")
        }
        const body = parsed.data
        const err = validateDefinition(body)
        if (err) return yield* failValidation(err)
        const existing = yield* fromPromise(() => Manager.get(params.id))
        if (!existing) return yield* failNotFound(`Mission "${params.id}" not found`)
        const saved = yield* upsertDefinition(body)
        yield* publishUpserted(saved.id)
        return saved
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

    start: ({ params, payload }: { params: { id: string }; payload: typeof StartPayload.Type | void }) =>
      Effect.gen(function* () {
        const def = yield* fromPromise(() => Manager.get(params.id))
        if (!def) return yield* failNotFound(`Mission "${params.id}" not found`)
        void Engine.start(params.id, payload?.sessionID ? { callerSessionID: payload.sessionID } : {})
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
            // Delete rather than assign `undefined`: `MissionFeature.error` is
            // `optionalKey`, which rejects a present `undefined` at encode time
            // and turns the whole response into an empty 400.
            if (payload.status === "done") delete next.error
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
        const saved = yield* upsertDefinition(updated)
        yield* publishUpserted(saved.id)
        return saved
      }),

    execs: ({ params, query }: { params: { id: string }; query: typeof ExecsQuery.Type }) =>
      fromPromise(async () => {
        const execs = await Manager.listExecs(params.id, query.limit ?? 100)
        return { execs }
      }),

    recentExecs: ({ query }: { query: typeof ExecsQuery.Type }) =>
      fromPromise(async () => {
        const records = await Manager.listRunningExecs()
        return { execs: records.slice(0, query.limit ?? 100) }
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
