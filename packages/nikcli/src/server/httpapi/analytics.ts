import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Analytics } from "@/analytics/analytics"
import { AnalyticsData } from "@/analytics/data"

export namespace AnalyticsHttpApi {
  const UnknownJson = Schema.Unknown

  /** Mirrors the legacy Hono 404 body: `{ error: "Session not found" }`. */
  const SessionNotFound = Schema.Struct({
    error: Schema.Literal("Session not found"),
  }).annotate({ identifier: "AnalyticsSessionNotFound", httpApiStatus: 404 })

  type SessionNotFoundBody = typeof SessionNotFound.Type

  const fromPromise = <A>(fn: () => Promise<A>) => Effect.promise(fn).pipe(Effect.orDie)

  const DailyQuery = Schema.Struct({
    from: Schema.optional(Schema.String),
    to: Schema.optional(Schema.String),
    days: Schema.optional(Schema.String),
  })

  const SessionIDPath = Schema.Struct({ sessionID: Schema.String })

  const DataQuery = Schema.Struct({
    days: Schema.optional(Schema.String),
    seriesDays: Schema.optional(Schema.String),
  })

  export const Group = HttpApiGroup.make("analytics")
    .add(HttpApiEndpoint.get("global", "/global", { success: UnknownJson }))
    .add(
      HttpApiEndpoint.get("daily", "/daily", {
        query: DailyQuery,
        success: UnknownJson,
      }),
    )
    .add(
      HttpApiEndpoint.get("session", "/session/:sessionID", {
        params: SessionIDPath,
        success: UnknownJson,
        error: SessionNotFound,
      }),
    )
    .add(HttpApiEndpoint.get("sessions", "/sessions", { success: UnknownJson }))
    .add(HttpApiEndpoint.get("leaderboard", "/leaderboard", { success: UnknownJson }))
    .add(
      HttpApiEndpoint.get("data", "/data", {
        query: DataQuery,
        success: UnknownJson,
      }),
    )
    .prefix("/analytics")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    global: () => fromPromise(() => Analytics.getGlobal()),

    daily: ({ query }: { query: typeof DailyQuery.Type }) =>
      fromPromise(async () => {
        const to = query.to || new Date().toISOString().split("T")[0]
        let from = query.from

        if (!from) {
          const days = parseInt(query.days || "90", 10)
          const d = new Date()
          d.setUTCDate(d.getUTCDate() - days)
          from = d.toISOString().split("T")[0]
        }

        return Analytics.getDaily(from, to)
      }),

    session: ({ params }: { params: { sessionID: string } }) =>
      fromPromise(() => Analytics.getSession(params.sessionID)).pipe(
        Effect.flatMap((session) =>
          session
            ? Effect.succeed(session as unknown)
            : Effect.fail<SessionNotFoundBody>({ error: "Session not found" }),
        ),
      ),

    sessions: () => fromPromise(() => Analytics.getAllSessions()),

    leaderboard: () =>
      fromPromise(async () => {
        const global = await Analytics.getGlobal()

        // Rank models by token usage
        const models = Object.entries(global.byModel)
          .map(([key, stats]) => ({
            key,
            providerID: key.split("/")[0],
            modelID: key.split("/").slice(1).join("/"),
            ...stats,
            totalTokens: stats.tokens.input + stats.tokens.output + stats.tokens.reasoning,
          }))
          .sort((a, b) => b.totalTokens - a.totalTokens)

        // Rank providers by cost
        const providers = Object.entries(global.byProvider)
          .map(([id, stats]) => ({ id, ...stats }))
          .sort((a, b) => b.cost - a.cost)

        // Rank projects by activity
        const projects = Object.entries(global.byProject)
          .map(([id, stats]) => ({ id, ...stats }))
          .sort((a, b) => b.lastActive - a.lastActive)

        return { models, providers, projects }
      }),

    // Same helper the Hono route calls, so the two surfaces cannot answer
    // differently. `null` when the window holds no tokens.
    data: ({ query }: { query: typeof DataQuery.Type }) =>
      fromPromise(() => AnalyticsData.refreshed(query) as Promise<unknown>),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "analytics", (builder) =>
    builder
      .handle("global", handlers.global)
      .handle("daily", handlers.daily)
      .handle("session", handlers.session)
      .handle("sessions", handlers.sessions)
      .handle("leaderboard", handlers.leaderboard)
      .handle("data", handlers.data),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
