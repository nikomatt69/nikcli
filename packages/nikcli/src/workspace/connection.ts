/**
 * Workspace connection module — owns the per-workspace SSE/event loop,
 * backoff/reconnect, status tracking, and process-exit cleanup. Replaces
 * the lifecycle bookkeeping that used to live inside `workspace/index.ts`
 * (status map, controllers, `startSpaceSync`/`stopSpaceSync`,
 * `workspaceEventLoop`, `mirrorWorkspaceEvent`, cleanup).
 *
 * Public surface is intentionally narrow:
 *   - `status(workspaceID)` and `current(workspaceID)` for reads
 *   - `start(space)` / `stop(workspaceID)` / `stopAll()` for lifecycle
 *   - `forget(workspaceID)` after a `workspace.removed` event lands
 *   - `registerProcessCleanup()` to install the beforeExit/SIGTERM/SIGINT
 *     handlers (call once per process)
 *
 * All side effects (DB writes, bus publish, hydrate via InstanceBootstrap)
 * go through injected helpers so the Module is testable behind the same
 * seam.
 */
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@nikcli-ai/util/global-bus"
import { InstanceBootstrap } from "@/project/bootstrap"
import { withInstanceAsync } from "@/effect"
import { PermissionNext } from "@/permission/next"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer, runService, withCurrentInstance } from "@/effect"
import { Log } from "@nikcli-ai/util/log"
import { WorkspaceDB } from "./db"
import { parseSSE } from "./sse"
import { SyncEmit } from "./sync-bridge"
import type { WorkspaceInfo, WorkspaceTarget } from "./types"
import { zod, zodObject } from "@nikcli-ai/util/effect-zod"
import { Identifier } from "@nikcli-ai/util/id"

const log = Log.create({ service: "workspace-connection" })

export const ConnectionStatusSchema = Schema.Literals(["connecting", "connected", "disconnected", "error"])
export const ConnectionStatus = zod(ConnectionStatusSchema)
export type ConnectionStatus = Schema.Schema.Type<typeof ConnectionStatusSchema>

const ConnectionStatusInfoSchema = Schema.Struct({
  workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
  status: ConnectionStatusSchema,
}).annotate({ identifier: "WorkspaceConnectionStatus" })
export const ConnectionStatusInfo = zodObject(ConnectionStatusInfoSchema)
export type ConnectionStatusInfo = Schema.Schema.Type<typeof ConnectionStatusInfoSchema>

const StatusEvent = BusEvent.schema(
  "workspace.status",
  Schema.Struct({
    workspaceID: Identifier.schemaEffect("workspace"),
    status: ConnectionStatusSchema,
  }),
)

const controllers = new Map<string, AbortController>()
const statuses = new Map<string, ConnectionStatus>()
const starting = new Set<string>() // mutex: prevent concurrent start for the same id

const RESTORE_EVENT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "workspace.ready",
  "workspace.failed",
  StatusEvent.type,
])

function eventSessionID(event: { properties?: any }): string | undefined {
  const properties = event.properties
  if (!properties || typeof properties !== "object") return
  if (typeof properties.sessionID === "string") return properties.sessionID
  if (typeof properties.info?.id === "string" && properties.info.id.startsWith("ses")) return properties.info.id
  if (typeof properties.info?.sessionID === "string") return properties.info.sessionID
  if (typeof properties.part?.sessionID === "string") return properties.part.sessionID
}

function eventWorkspaceID(event: { properties?: any }): string | undefined {
  const workspaceID = event.properties?.info?.workspaceID
  return typeof workspaceID === "string" ? workspaceID : undefined
}

async function acceptsWorkspaceEvent(
  workspaceID: string,
  event: { type?: string; properties?: any },
): Promise<boolean> {
  if (!event?.type || event.type === "server.heartbeat") return false
  const declared = eventWorkspaceID(event)
  if (declared && declared !== workspaceID) return false
  const sessionID = eventSessionID(event)
  if (!sessionID) return true
  const session = await runService(
    Session,
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      return yield* sessions.getAnyProject(sessionID)
    }),
    withCurrentInstance,
  ).catch(() => undefined)
  if (!session) return declared === undefined || declared === workspaceID
  return session.workspaceID === workspaceID
}

function syncDirectory(space: WorkspaceInfo): string | undefined {
  if (space.config.type === "worktree") return
  return space.config.directory
}

function hydrateStatus(sessionID: string, status: SessionStatus.Info) {
  return runPromiseWithLayer(
    SessionStatus.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const service = yield* SessionStatus.Service
        return yield* service.hydrate(sessionID, status)
      }),
    ),
  )
}

function runPermission<A, E>(effect: Effect.Effect<A, E, PermissionNext.Service>) {
  return runService(PermissionNext, effect, withCurrentInstance)
}

async function mirrorWorkspaceEvent(space: WorkspaceInfo, event: { type?: string; properties?: any }) {
  const directory = syncDirectory(space)
  if (!directory || !event?.type) return
  await withInstanceAsync({ directory, init: InstanceBootstrap }, async () => {
    if (event.type === "session.status" && event.properties?.sessionID && event.properties?.status) {
      await hydrateStatus(event.properties.sessionID, event.properties.status)
    }
    if (event.type === "session.idle" && event.properties?.sessionID) {
      await hydrateStatus(event.properties.sessionID, { type: "idle" })
    }
    if (event.type === "permission.asked" && event.properties?.id) {
      await runPermission(
        Effect.gen(function* () {
          const permission = yield* PermissionNext.Service
          yield* permission.hydrateAsk(event.properties)
        }),
      )
    }
    if (event.type === "permission.replied" && event.properties?.requestID) {
      await runPermission(
        Effect.gen(function* () {
          const permission = yield* PermissionNext.Service
          yield* permission.hydrateReply(event.properties.requestID)
        }),
      )
    }
  })
}

function rememberWorkspaceEvent(projectID: string, workspaceID: string, event: { type?: string; properties?: any }) {
  if (!event?.type || event.type === "server.heartbeat") return
  if (!RESTORE_EVENT_TYPES.has(event.type)) return
  void SyncEmit.workspaceEvent(projectID, workspaceID, event).catch((error) => {
    log.warn("workspace event sync emit failed", { workspaceID, error })
  })
}

function setStatus(workspaceID: string, next: ConnectionStatus) {
  const prev = statuses.get(workspaceID)
  if (prev === next) return
  statuses.set(workspaceID, next)
  WorkspaceDB.setStatusColumn(workspaceID, next)
  void Bus.publish(StatusEvent, { workspaceID, status: next }).catch(() => undefined)
}

async function workspaceEventLoop(space: WorkspaceInfo, stop: AbortSignal, target: WorkspaceTarget | undefined) {
  if (!target || target.type === "local") return

  const baseURL = String(target.url).replace(/\/?$/, "/")
  const BACKOFF_BASE_MS = 1000
  const BACKOFF_CAP_MS = 30_000
  let backoff = BACKOFF_BASE_MS

  try {
    while (!stop.aborted) {
      setStatus(space.id, "connecting")
      const res = await fetch(new URL(baseURL + "event"), {
        method: "GET",
        headers: target.headers,
        signal: stop,
      }).catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        setStatus(space.id, "error")
        await Bun.sleep(backoff)
        backoff = Math.min(backoff * 2, BACKOFF_CAP_MS)
        continue
      }
      backoff = BACKOFF_BASE_MS
      setStatus(space.id, "connected")
      await parseSSE(res.body, stop, (event) => {
        const payload = event as { type?: string; properties?: any }
        void acceptsWorkspaceEvent(space.id, payload)
          .then((accepted) => {
            if (!accepted) return
            // The workspace's own project, not the ambient one: this runs in a
            // detached SSE loop that outlives the scope it was started from.
            rememberWorkspaceEvent(space.projectID, space.id, payload)
            void mirrorWorkspaceEvent(space, payload).catch((error) => {
              log.warn("workspace event mirror failed", {
                workspaceID: space.id,
                error,
                type: payload?.type,
              })
            })
            GlobalBus.emit("event", { directory: space.id, payload })
          })
          .catch((error) => {
            log.warn("workspace event ownership check failed", {
              workspaceID: space.id,
              error,
              type: payload?.type,
            })
          })
      })
      if (!stop.aborted) setStatus(space.id, "connecting")
      await Bun.sleep(250)
    }
  } finally {
    setStatus(space.id, "disconnected")
  }
}

export const WorkspaceConnection = {
  /** Returns the current in-memory status; falls back to the DB column, then "disconnected". */
  status(workspaceID: string): ConnectionStatus {
    return (statuses.get(workspaceID) ?? WorkspaceDB.getStatus(workspaceID) ?? "disconnected") as ConnectionStatus
  },

  /** In-memory status only (no DB read). Used by callers that need the
   *  post-start state without touching SQLite (e.g. restore fast-path). */
  current(workspaceID: string): ConnectionStatus | undefined {
    return statuses.get(workspaceID)
  },

  /** Stamp a status without starting a loop (e.g. local worktree restore,
   *  health check result). Mirrors the previous `Workspace.setStatus`
   *  helper. */
  set(workspaceID: string, next: ConnectionStatus) {
    setStatus(workspaceID, next)
  },

  /** Idempotent: starts the SSE loop for the given workspace if it isn't
   *  already running. Local worktree configs are skipped. The caller
   *  resolves `target` (so the Module is testable with an in-memory
   *  transport without hitting the workspace index). */
  start(space: WorkspaceInfo, target: WorkspaceTarget | undefined) {
    if (space.config.type === "worktree") return
    if (controllers.has(space.id)) return
    if (starting.has(space.id)) return
    starting.add(space.id)

    const stop = new AbortController()
    controllers.set(space.id, stop)

    void workspaceEventLoop(space, stop.signal, target)
      .catch((error) => {
        log.warn("workspace sync listener failed", {
          workspaceID: space.id,
          error,
        })
      })
      .finally(() => {
        if (controllers.get(space.id) === stop) controllers.delete(space.id)
        starting.delete(space.id)
      })
  },

  /** Abort the loop and drop the controller. Safe to call when not running. */
  stop(workspaceID: string) {
    const controller = controllers.get(workspaceID)
    if (!controller) return
    controller.abort()
    controllers.delete(workspaceID)
  },

  /** Drop in-memory state for a workspace that's been removed. */
  forget(workspaceID: string) {
    statuses.delete(workspaceID)
  },

  stopAll() {
    // snapshot first: stop() deletes from controllers during iteration
    const ids = Array.from(controllers.keys())
    for (const id of ids) {
      WorkspaceConnection.stop(id)
    }
  },

  /** Subscribe to status transitions. Re-exported so `Workspace.restore`
   *  (and tests) can wait for a target status without reaching into Bus. */
  onStatus(handler: (info: { workspaceID: string; status: ConnectionStatus }) => void) {
    return Bus.subscribe(StatusEvent, (event) => {
      const properties = (
        event as {
          properties?: { workspaceID?: string; status?: ConnectionStatus }
        }
      ).properties
      if (!properties?.workspaceID || !properties.status) return
      handler({
        workspaceID: properties.workspaceID,
        status: properties.status,
      })
    })
  },

  /** Install the beforeExit/SIGTERM/SIGINT handlers once per process. */
  registerProcessCleanup() {
    if (processCleanupInstalled) return
    processCleanupInstalled = true
    const cleanupOnce = () => {
      processCleanupInstalled = false
      log.info("cleanup: stopping all workspace sync loops")
      WorkspaceConnection.stopAll()
      statuses.clear()
    }
    process.once("beforeExit", cleanupOnce)
    process.once("SIGTERM", cleanupOnce)
    process.once("SIGINT", cleanupOnce)
  },
}

let processCleanupInstalled = false

// Auto-register process-exit handlers when this module is first imported.
// Keeps the responsibility for cleanup ownership inside the connection
// Module and avoids circular coupling with `workspace/index.ts` (which is
// the natural caller).
WorkspaceConnection.registerProcessCleanup()
