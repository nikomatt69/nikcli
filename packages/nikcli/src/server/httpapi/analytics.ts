import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Analytics } from "@/analytics/analytics"
import { AnalyticsData } from "@/analytics/data"

export namespace AnalyticsHttpApi {
  /**
   * These mirror the zod schemas in `@/analytics/analytics` and the interfaces
   * in `@/analytics/data`. They are declared as Effect Schemas rather than
   * `Schema.Unknown` so the generated clients carry real types instead of
   * `any`. Keep them in sync with the service: the Effect bridge validates
   * response bodies at runtime, so a field that drifts here fails the request.
   */
  const TokenBreakdown = Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    reasoning: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
  }).annotate({ identifier: "AnalyticsTokenBreakdown" })

  const ModelTokens = Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    reasoning: Schema.Number,
  }).annotate({ identifier: "AnalyticsModelTokens" })

  const ProviderStat = Schema.Struct({
    sessions: Schema.Number,
    messages: Schema.Number,
    tokens: Schema.Number,
    cost: Schema.Number,
  }).annotate({ identifier: "AnalyticsProviderStat" })

  const ModelStat = Schema.Struct({
    sessions: Schema.Number,
    messages: Schema.Number,
    tokens: ModelTokens,
    cost: Schema.Number,
    firstUsed: Schema.Number,
    lastUsed: Schema.Number,
  }).annotate({ identifier: "AnalyticsModelStat" })

  const ProjectStat = Schema.Struct({
    sessions: Schema.Number,
    tokens: Schema.Number,
    cost: Schema.Number,
    lastActive: Schema.Number,
  }).annotate({ identifier: "AnalyticsProjectStat" })

  const GlobalAnalytics = Schema.Struct({
    version: Schema.Literal(1),
    updatedAt: Schema.Number,
    totals: Schema.Struct({
      sessions: Schema.Number,
      messages: Schema.Number,
      tokens: TokenBreakdown,
      cost: Schema.Number,
      toolCalls: Schema.Number,
    }),
    byProvider: Schema.Record(Schema.String, ProviderStat),
    byModel: Schema.Record(Schema.String, ModelStat),
    byProject: Schema.Record(Schema.String, ProjectStat),
  }).annotate({ identifier: "AnalyticsGlobal" })

  const DailyAnalytics = Schema.Struct({
    date: Schema.String,
    sessions: Schema.Number,
    messages: Schema.Number,
    tokens: TokenBreakdown,
    cost: Schema.Number,
    toolCalls: Schema.Number,
    tools: Schema.Record(
      Schema.String,
      Schema.Struct({ calls: Schema.Number, success: Schema.Number, error: Schema.Number }),
    ),
    providers: Schema.Record(
      Schema.String,
      Schema.Struct({ messages: Schema.Number, tokens: Schema.Number, cost: Schema.Number }),
    ),
    models: Schema.Record(
      Schema.String,
      Schema.Struct({ messages: Schema.Number, tokens: Schema.Number, cost: Schema.Number }),
    ),
    recordedAt: Schema.Number,
  }).annotate({ identifier: "AnalyticsDaily" })

  const SessionAnalytics = Schema.Struct({
    sessionID: Schema.String,
    projectID: Schema.String,
    directory: Schema.String,
    title: Schema.String,
    providerID: Schema.String,
    modelID: Schema.String,
    messages: Schema.Number,
    tokens: TokenBreakdown,
    cost: Schema.Number,
    toolCalls: Schema.Number,
    duration: Schema.Number,
    time: Schema.Struct({ created: Schema.Number, completed: Schema.Number }),
  }).annotate({ identifier: "AnalyticsSession" })

  /** Built inline by the `leaderboard` handler from `getGlobal()`. */
  const Leaderboard = Schema.Struct({
    models: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        providerID: Schema.String,
        modelID: Schema.String,
        sessions: Schema.Number,
        messages: Schema.Number,
        tokens: ModelTokens,
        cost: Schema.Number,
        firstUsed: Schema.Number,
        lastUsed: Schema.Number,
        totalTokens: Schema.Number,
      }),
    ),
    providers: Schema.Array(Schema.Struct({ id: Schema.String, ...ProviderStat.fields })),
    projects: Schema.Array(Schema.Struct({ id: Schema.String, ...ProjectStat.fields })),
  }).annotate({ identifier: "AnalyticsLeaderboard" })

  const DataModelStat = Schema.Struct({
    model: Schema.String,
    provider: Schema.String,
    author: Schema.String,
    tokens: Schema.Number,
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    reasoningTokens: Schema.Number,
    cacheReadTokens: Schema.Number,
    cacheWriteTokens: Schema.Number,
    sessions: Schema.Number,
    messages: Schema.Number,
    toolCalls: Schema.Number,
    costUsd: Schema.Number,
    share: Schema.Number,
    pricePerMillion: Schema.Number,
    costPerSession: Schema.Number,
    tokensPerSession: Schema.Number,
    cacheRatio: Schema.NullOr(Schema.Number),
  }).annotate({ identifier: "AnalyticsDataModelStat" })

  const DataPeriodStat = Schema.Struct({
    month: Schema.NullOr(Schema.String),
    tokens: Schema.Number,
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    cacheReadTokens: Schema.Number,
    messages: Schema.Number,
    toolCalls: Schema.Number,
    sessions: Schema.Number,
    costUsd: Schema.Number,
    models: Schema.Number,
    pricePerMillion: Schema.Number,
    costPerSession: Schema.Number,
    cacheRatio: Schema.NullOr(Schema.Number),
  }).annotate({ identifier: "AnalyticsDataPeriodStat" })

  /** `null` when the window holds no tokens. */
  const AnalyticsDataOutput = Schema.NullOr(
    Schema.Struct({
      totals: Schema.Struct({
        tokens: Schema.Number,
        inputTokens: Schema.Number,
        outputTokens: Schema.Number,
        cacheReadTokens: Schema.Number,
        sessions: Schema.Number,
        messages: Schema.Number,
        toolCalls: Schema.Number,
        costUsd: Schema.Number,
        models: Schema.Number,
        providers: Schema.Number,
        authors: Schema.Number,
        pricePerMillion: Schema.Number,
        costPerSession: Schema.Number,
        tokensPerSession: Schema.Number,
        cacheRatio: Schema.NullOr(Schema.Number),
        change: Schema.NullOr(Schema.Number),
      }),
      models: Schema.Array(DataModelStat),
      authors: Schema.Array(
        Schema.Struct({
          author: Schema.String,
          tokens: Schema.Number,
          sessions: Schema.Number,
          share: Schema.Number,
          models: Schema.Number,
        }),
      ),
      series: Schema.Array(
        Schema.Struct({
          day: Schema.String,
          byModel: Schema.Record(Schema.String, Schema.Number),
          tokens: Schema.Number,
          sessions: Schema.Number,
        }),
      ),
      months: Schema.Array(DataPeriodStat),
      lifetime: DataPeriodStat,
      seriesModels: Schema.Array(Schema.String),
      windowDays: Schema.Number,
      seriesDays: Schema.Number,
      from: Schema.String,
      to: Schema.String,
      generatedAt: Schema.Number,
    }),
  ).annotate({ identifier: "AnalyticsData" })

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
    .add(HttpApiEndpoint.get("global", "/global", { success: GlobalAnalytics }))
    .add(
      HttpApiEndpoint.get("daily", "/daily", {
        query: DailyQuery,
        success: Schema.Array(DailyAnalytics),
      }),
    )
    .add(
      HttpApiEndpoint.get("session", "/session/:sessionID", {
        params: SessionIDPath,
        success: SessionAnalytics,
        error: SessionNotFound,
      }),
    )
    .add(HttpApiEndpoint.get("sessions", "/sessions", { success: Schema.Array(SessionAnalytics) }))
    .add(HttpApiEndpoint.get("leaderboard", "/leaderboard", { success: Leaderboard }))
    .add(
      HttpApiEndpoint.get("data", "/data", {
        query: DataQuery,
        success: AnalyticsDataOutput,
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
          session ? Effect.succeed(session) : Effect.fail<SessionNotFoundBody>({ error: "Session not found" }),
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
    data: ({ query }: { query: typeof DataQuery.Type }) => fromPromise(() => AnalyticsData.refreshed(query)),
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
