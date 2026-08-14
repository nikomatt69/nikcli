import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Brain, getBrainConfig, getSessionsCountSince, readLastBrainAt } from "@/brain"
import { Log } from "@nikcli-ai/util/log"

export namespace BrainHttpApi {
  const log = Log.create({ service: "httpapi.brain" })

  const HOUR_MS = 60 * 60 * 1000

  const Status = Schema.Struct({
    enabled: Schema.Boolean,
    memoryEnabled: Schema.Boolean,
    minHours: Schema.Number,
    minSessions: Schema.Number,
    lastBrainAt: Schema.Number,
    hoursSinceLastBrain: Schema.Number,
    sessionsSinceLastBrain: Schema.Number,
    shouldTrigger: Schema.Boolean,
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
  }).annotate({ identifier: "BrainStatus" })

  const TriggerPayload = Schema.Struct({
    force: Schema.optional(Schema.Boolean),
  }).annotate({ identifier: "BrainTriggerInput" })

  const Result = Schema.Struct({
    success: Schema.Boolean,
    sessionsReviewed: Schema.Number,
    hoursSinceLastBrain: Schema.Number,
    error: Schema.optional(Schema.String),
    sessionID: Schema.optional(Schema.String),
  }).annotate({ identifier: "BrainResult" })

  const fromPromise = <A>(fn: () => Promise<A>) => Effect.promise(fn).pipe(Effect.orDie)

  export const Group = HttpApiGroup.make("brain")
    .add(HttpApiEndpoint.get("status", "/", { success: Status }))
    .add(
      HttpApiEndpoint.post("trigger", "/trigger", {
        payload: TriggerPayload,
        success: Result,
      }),
    )
    .prefix("/brain")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    status: () =>
      fromPromise(async () => {
        const cfg = await getBrainConfig()
        const lastBrainAt = await readLastBrainAt()
        const hoursSinceLastBrain = lastBrainAt ? (Date.now() - lastBrainAt) / HOUR_MS : Number.POSITIVE_INFINITY
        const sessionsSinceLastBrain = await getSessionsCountSince(lastBrainAt)
        const shouldTrigger = await Brain.shouldTrigger().catch(() => false)
        return {
          enabled: cfg.enabled,
          memoryEnabled: cfg.memoryEnabled,
          minHours: cfg.minHours,
          minSessions: cfg.minSessions,
          lastBrainAt,
          hoursSinceLastBrain: Number.isFinite(hoursSinceLastBrain) ? hoursSinceLastBrain : -1,
          sessionsSinceLastBrain,
          shouldTrigger,
          model: cfg.model,
        }
      }),

    trigger: ({ payload }: { payload: typeof TriggerPayload.Type }) =>
      fromPromise(() => {
        log.info("brain trigger requested", { force: payload.force })
        return Brain.trigger({ force: payload.force })
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "brain", (builder) =>
    builder.handle("status", handlers.status).handle("trigger", handlers.trigger),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
