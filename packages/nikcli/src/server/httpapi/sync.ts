import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { Sync } from "@/sync"
import { Auth } from "./auth"
import { MobileAuth } from "@/mobile/auth"
import { Log } from "@/util/log"

type HttpResponse = ReturnType<typeof HttpServerResponse.fromWeb>

const log = Log.create({ service: "sync-httpapi-auth" })

const SYNC_SCOPES = new Set(["cli-sync", "studio"])

/**
 * Verify a `?token=` query parameter against the bearer-token registry
 * and the `cli-sync` / `studio` scope list. Mirrors the Hono `.use("*", ...)`
 * middleware on `routes/sync.ts:93-104`:
 *  - No token present → request passes through (operator / basic-auth path)
 *  - Token present but invalid → 401 Unauthorized
 *  - Token valid but wrong scope → 403 Forbidden
 *  - Token valid with the right scope → request continues
 *
 * The `request` parameter is the Effect `HttpServerRequest` exposed on
 * every typed HttpApi handler — it carries the raw URL, so we can
 * extract the token via `Auth.extractQueryToken` without depending on
 * the schema-decoded payload.
 */
function authorizeSync(request: { readonly url: string }): Effect.Effect<undefined | HttpResponse, never, never> {
  const url = new URL(request.url, "http://nikcli.local")
  const token = Auth.extractQueryToken(url)
  if (!token) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const verified = yield* Effect.promise(() => MobileAuth.verify(token))
    if (!verified) {
      log.warn("sync token verify failed", { url: url.pathname })
      return HttpServerResponse.fromWeb(new Response("Unauthorized: invalid auth_token", { status: 401 }))
    }
    if (!SYNC_SCOPES.has(verified.scope ?? "mobile")) {
      log.warn("sync access denied: insufficient scope", {
        tokenID: verified.id,
        scope: verified.scope,
        url: url.pathname,
      })
      return HttpServerResponse.fromWeb(
        new Response("Forbidden: sync requires a cli-sync or studio token", {
          status: 403,
        }),
      )
    }
    return undefined
  })
}

/**
 * Effect backend for the `/sync/*` JSON surface (Wave 4, Sync.Service
 * extraction). Mirrors the design in `specs/effect/sync-service.md`:
 *
 *  - `POST /sync/start`    → `Sync.Service.start(...)`
 *      payload: `{ url, token, projectID }`
 *      success: `{ started: boolean; error?: string }`
 *
 *  - `POST /sync/replay`   → `Sync.Service.push(...)`
 *      payload: `{ projectID, aggregate, data, origin? }`
 *      success: `{ accepted: true }`
 *
 *  - `GET  /sync/history`  → `Sync.Service.outbox(...)`
 *      query:   `{ projectID, aggregate, since?, limit? }`
 *      success: `{ events: SyncEventRecord[]; hasMore: boolean }`
 *
 *  - `GET  /sync/snapshot` → `Sync.Service.snapshot(...)`
 *      query:   `{ projectID, aggregate }`
 *      success: `{ lastSeq: number; state: unknown } | null`
 *
 * `/sync/stream` (SSE feed) stays a Hono "special" branch parallel to
 * `HttpApiEvent.handle()` and the `/chatbot/*` webhook receivers — schema
 * routing is the wrong abstraction for streaming.
 *
 * Auth (Wave 4 follow-up, landed 2026-07-08): every handler calls
 * `authorizeSync(request)` first, which mirrors the Hono
 * `.use("*", ...)` scope guard at `routes/sync.ts:93-104`. When the
 * caller presents a `?token=` query parameter we verify it through
 * the bearer-token registry (`MobileAuth.verify`); a valid token must
 * carry `cli-sync` or `studio` scope. When no token is presented, the
 * request falls through to the bridge-level basic-auth shim. The
 * OpenAPI-side `HttpApiSecurity.apiKey({ in: "query", key: "token" })`
 * declaration is a follow-up. Closes the gap from
 * `specs/effect/sync-service.md` §5.
 */
export namespace SyncHttpApi {
  const StartPayload = Schema.Struct({
    url: Schema.String.annotate({ description: "Remote hub URL" }),
    token: Schema.String.annotate({ description: "Remote hub bearer token" }),
    projectID: Schema.String.annotate({
      description: "Project to register with the hub",
    }),
  }).annotate({ identifier: "SyncStartInput" })

  const StartResponse = Schema.Struct({
    started: Schema.Boolean,
    error: Schema.optional(Schema.String),
  }).annotate({ identifier: "SyncStartResponse" })

  const ReplayPayload = Schema.Struct({
    projectID: Schema.String,
    aggregate: Schema.String,
    data: Schema.Unknown,
    origin: Schema.optional(Schema.String),
  }).annotate({ identifier: "SyncReplayInput" })

  const ReplayResponse = Schema.Struct({
    accepted: Schema.Literal(true),
  }).annotate({ identifier: "SyncReplayResponse" })

  const HistoryQuery = Schema.Struct({
    projectID: Schema.String,
    aggregate: Schema.String,
    since: Schema.optional(Schema.Number).annotate({
      description: "Filter events with seq > since",
    }),
    limit: Schema.optional(Schema.Number).annotate({
      description: "Page size (default 100, max 1000)",
    }),
  }).annotate({ identifier: "SyncHistoryQuery" })

  const HistoryResponse = Schema.Struct({
    events: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        projectId: Schema.String,
        workspaceId: Schema.optional(Schema.String),
        aggregate: Schema.String,
        seq: Schema.Number,
        type: Schema.String,
        data: Schema.Unknown,
        timestamp: Schema.Number,
        origin: Schema.optional(Schema.String),
        originSeq: Schema.optional(Schema.Number),
      }).annotate({ identifier: "SyncEventRecord" }),
    ),
    hasMore: Schema.Boolean,
  }).annotate({ identifier: "SyncHistoryResponse" })

  const SnapshotQuery = Schema.Struct({
    projectID: Schema.String,
    aggregate: Schema.String,
  }).annotate({ identifier: "SyncSnapshotQuery" })

  const SnapshotResponse = Schema.NullOr(
    Schema.Struct({
      lastSeq: Schema.Number,
      state: Schema.Unknown,
    }),
  ).annotate({ identifier: "SyncSnapshotResponse" })

  export const Group = HttpApiGroup.make("sync")
    .add(
      HttpApiEndpoint.post("start", "/start", {
        payload: StartPayload,
        success: StartResponse,
      }),
    )
    .add(
      HttpApiEndpoint.post("replay", "/replay", {
        payload: ReplayPayload,
        success: ReplayResponse,
      }),
    )
    .add(
      HttpApiEndpoint.get("history", "/history", {
        query: HistoryQuery,
        success: HistoryResponse,
      }),
    )
    .add(
      HttpApiEndpoint.get("snapshot", "/snapshot", {
        query: SnapshotQuery,
        success: SnapshotResponse,
      }),
    )
    .prefix("/sync")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    start: ({ payload, request }: { payload: typeof StartPayload.Type; request: { readonly url: string } }) =>
      Effect.gen(function* () {
        const auth = yield* authorizeSync(request)
        if (auth) return auth
        const service = yield* Sync.Service
        return yield* service.start({
          url: payload.url,
          token: payload.token,
          projectID: payload.projectID,
        })
      }).pipe(Effect.orDie),

    replay: ({ payload, request }: { payload: typeof ReplayPayload.Type; request: { readonly url: string } }) =>
      Effect.gen(function* () {
        const auth = yield* authorizeSync(request)
        if (auth) return auth
        const service = yield* Sync.Service
        yield* service.push(payload.projectID, {
          aggregate: payload.aggregate,
          data: payload.data,
          origin: payload.origin,
        })
        return { accepted: true as const }
      }).pipe(Effect.orDie),

    history: ({ query, request }: { query: typeof HistoryQuery.Type; request: { readonly url: string } }) =>
      Effect.gen(function* () {
        const auth = yield* authorizeSync(request)
        if (auth) return auth
        const service = yield* Sync.Service
        return yield* service.outbox(query.projectID, query.aggregate, query.since ?? 0, query.limit)
      }).pipe(Effect.orDie),

    snapshot: ({ query, request }: { query: typeof SnapshotQuery.Type; request: { readonly url: string } }) =>
      Effect.gen(function* () {
        const auth = yield* authorizeSync(request)
        if (auth) return auth
        const service = yield* Sync.Service
        return yield* service.snapshot(query.aggregate, query.projectID)
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "sync", (builder) =>
    builder
      .handle("start", (request) => handlers.start(request))
      .handle("replay", (request) => handlers.replay(request))
      .handle("history", (request) => handlers.history(request))
      .handle("snapshot", (request) => handlers.snapshot(request)),
  )

  export const DependenciesLive = Sync.defaultLayer

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
