import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Schema } from "effect"

/**
 * Contract-only Effect schema for the real `/sync/*` surface served by Hono
 * (`routes/sync.ts`). This group is part of `PublicApi` (the generation
 * contract) but NOT of the served `PublicHttpApi.Api`: every `/sync` request
 * is handled by the Hono router today, so no Effect handlers exist here.
 *
 * History: an earlier Wave 4 group exposed four invented endpoints
 * (`POST /sync/start`, `POST /sync/replay`, `GET /sync/history`,
 * `GET /sync/snapshot`) that never existed on the Hono side and had no
 * callers. They were dropped when the spec was realigned with the real
 * routes — the Effect handler migration for the real surface below is a
 * follow-up tied to the Sync.Service extraction (`specs/effect/sync-service.md`).
 *
 * `OpenApi.Identifier` pins each operationId to the value the Hono OpenAPI
 * emits, so the SDK generated from either source has the same class tree.
 */
export namespace SyncHttpApi {
  const SyncEventRecord = Schema.Struct({
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
  }).annotate({ identifier: "SyncEventRecord" })

  const EventPushPayload = Schema.Struct({
    event: SyncEventRecord,
    projectID: Schema.String,
  }).annotate({ identifier: "SyncEventPushInput" })

  const OutboxQuery = Schema.Struct({
    projectID: Schema.String,
    since: Schema.optional(Schema.NumberFromString).annotate({
      description: "Return events with seq > since (default 0)",
    }),
  })

  const OutboxResponse = Schema.Struct({
    events: Schema.Array(Schema.Unknown),
    hasMore: Schema.Boolean,
  }).annotate({ identifier: "SyncOutboxResponse" })

  const SnapshotPath = Schema.Struct({
    aggregateID: Schema.String,
  })

  const SnapshotQuery = Schema.Struct({
    projectID: Schema.String,
  })

  const SnapshotResponse = Schema.Struct({
    lastSeq: Schema.Number,
    state: Schema.Unknown,
  }).annotate({ identifier: "SyncSnapshotResponse" })

  const StreamQuery = Schema.Struct({
    projectID: Schema.String,
    token: Schema.String.annotate({
      description: "Bearer token via query parameter — EventSource cannot send custom headers",
    }),
  })

  const StatsQuery = Schema.Struct({
    projectID: Schema.optional(Schema.String),
  })

  const ConfigSetPayload = Schema.Struct({
    url: Schema.String,
    token: Schema.optional(Schema.String).annotate({
      description: "Omit to keep the token already saved in the config file",
    }),
    autostart: Schema.optional(Schema.Boolean),
  }).annotate({ identifier: "SyncConfigSetInput" })

  const ConfigSetResponse = Schema.Struct({
    configured: Schema.Boolean,
    url: Schema.optional(Schema.String),
    source: Schema.optional(Schema.Literals(["env", "config"])),
    started: Schema.Boolean,
    error: Schema.optional(Schema.String),
  }).annotate({ identifier: "SyncConfigSetResponse" })

  export const Group = HttpApiGroup.make("sync")
    .add(
      HttpApiEndpoint.post("event", "/event", {
        payload: EventPushPayload,
        success: HttpApiSchema.NoContent,
      }).annotate(OpenApi.Identifier, "sync.event.push"),
    )
    .add(
      HttpApiEndpoint.get("outbox", "/outbox", {
        query: OutboxQuery,
        success: OutboxResponse,
      }).annotate(OpenApi.Identifier, "sync.outbox.list"),
    )
    .add(
      HttpApiEndpoint.get("snapshot", "/snapshot/:aggregateID", {
        params: SnapshotPath,
        query: SnapshotQuery,
        success: SnapshotResponse,
      }).annotate(OpenApi.Identifier, "sync.snapshot.get"),
    )
    .add(
      HttpApiEndpoint.get("stream", "/stream", {
        query: StreamQuery,
        success: HttpApiSchema.StreamSse({ data: Schema.Unknown }),
      }).annotate(OpenApi.Identifier, "sync.event.stream"),
    )
    .add(
      HttpApiEndpoint.get("stats", "/stats", {
        query: StatsQuery,
        success: Schema.Unknown,
      }).annotate(OpenApi.Identifier, "sync.stats"),
    )
    .add(
      HttpApiEndpoint.post("config", "/config", {
        payload: ConfigSetPayload,
        success: ConfigSetResponse,
      }).annotate(OpenApi.Identifier, "sync.config.set"),
    )
    .add(
      HttpApiEndpoint.post("connect", "/connect", {
        success: HttpApiSchema.NoContent,
      }).annotate(OpenApi.Identifier, "sync.connect"),
    )
    .add(
      HttpApiEndpoint.post("disconnect", "/disconnect", {
        success: HttpApiSchema.NoContent,
      }).annotate(OpenApi.Identifier, "sync.disconnect"),
    )
    .add(
      HttpApiEndpoint.post("drain", "/drain", {
        success: HttpApiSchema.NoContent,
      }).annotate(OpenApi.Identifier, "sync.drain"),
    )
    .prefix("/sync")
}
