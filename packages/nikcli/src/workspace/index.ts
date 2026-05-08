import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Project } from "@/project/project"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { getAdaptor } from "./adaptors"
import { Config, ConfigSchema } from "./config"
import { parseSSE } from "./sse"
import { SandboxRegistry } from "@/sandbox/registry"
import { WorkspaceDB } from "./db"
import { zod, zodObject, zodObjectMode } from "@/util/effect-zod"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function storageRead<T>(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.read<T>(key)
    }),
  )
}

function storageList(prefix: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(prefix)
    }),
  )
}

export namespace Workspace {
  const ConnectionStatusSchema = Schema.Literal("connecting", "connected", "disconnected", "error")
  export const ConnectionStatus = zod(ConnectionStatusSchema)
  export type ConnectionStatus = Schema.Schema.Type<typeof ConnectionStatusSchema>

  export const Event = {
    Ready: BusEvent.define(
      "workspace.ready",
      Schema.Struct({
        name: Schema.String,
      }).annotations(zodObjectMode("strip")),
    ),
    Failed: BusEvent.define(
      "workspace.failed",
      Schema.Struct({
        message: Schema.String,
      }).annotations(zodObjectMode("strip")),
    ),
    Status: BusEvent.define(
      "workspace.status",
      Schema.Struct({
        workspaceID: Identifier.schemaEffect("workspace"),
        status: ConnectionStatusSchema,
      }).annotations(zodObjectMode("strip")),
    ),
  }

  const InfoSchema = Schema.Struct({
    id: Schema.String.pipe(Schema.startsWith("wrk")),
    branch: Schema.NullOr(Schema.String),
    projectID: Schema.String,
    config: ConfigSchema,
  }).annotations({ identifier: "Workspace" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  function runPermission<A, E>(effect: Effect.Effect<A, E, PermissionNext.Service>) {
    return runPromiseWithLayer(PermissionNext.defaultLayer, withCurrentInstance(effect))
  }

  function hydrateStatus(sessionID: string, status: SessionStatus.Info) {
    return runPromiseWithLayer(
      SessionStatus.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const sessionStatus = yield* SessionStatus.Service
          return yield* sessionStatus.hydrate(sessionID, status)
        }),
      ),
    )
  }

  const RestoreSchema = Schema.Struct({
    workspaceID: Schema.String.pipe(Schema.startsWith("wrk")),
    sessions: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] as ReadonlyArray<string> }),
    events: Schema.optionalWith(Schema.Array(Schema.Unknown), { default: () => [] as ReadonlyArray<unknown> }),
  }).annotations({ identifier: "Workspace.Restore" })
  export const Restore = zodObject(RestoreSchema)
  export type Restore = Schema.Schema.Type<typeof RestoreSchema>

  const SessionRestoreSchema = Schema.Struct({
    workspaceID: Schema.String.pipe(Schema.startsWith("wrk")),
    sessions: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] as ReadonlyArray<string> }),
    events: Schema.optionalWith(Schema.Array(Schema.Unknown), { default: () => [] as ReadonlyArray<unknown> }),
    sessionID: Schema.String.pipe(Schema.startsWith("ses")),
  }).annotations({ identifier: "Workspace.SessionRestore" })
  export const SessionRestore = zodObject(SessionRestoreSchema)
  export type SessionRestore = Schema.Schema.Type<typeof SessionRestoreSchema>

  function fromRow(row: WorkspaceDB.Info): Info {
    return Info.parse({
      ...row,
      branch: row.branch ?? null,
    })
  }

  const syncControllers = new Map<string, AbortController>()
  const connectionStatuses = new Map<string, ConnectionStatus>()
  const startingSync = new Set<string>() // Mutex to prevent concurrent sync starts
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
    Event.Ready.type,
    Event.Failed.type,
    Event.Status.type,
  ])

  async function listRootSessions(workspaceID: string) {
    const sessions = [] as Session.Info[]
    for (const key of await storageList(["session", Instance.project.id])) {
      const session = await storageRead<Session.Info>(key).catch(() => undefined)
      if (!session || session.workspaceID !== workspaceID || session.parentID) continue
      sessions.push(session)
    }
    return sessions.toSorted((a, b) => b.time.updated - a.time.updated).map((session) => session.id)
  }

  async function buildRestorePayload(workspaceID: string): Promise<Restore> {
    const state = WorkspaceDB.getState(workspaceID)
    return {
      workspaceID,
      sessions: await listRootSessions(workspaceID),
      events: state.events,
    }
  }

  export function status(workspaceID: string): ConnectionStatus {
    return (connectionStatuses.get(workspaceID) ??
      WorkspaceDB.getState(workspaceID).status ??
      "disconnected") as ConnectionStatus
  }

  function setStatus(workspaceID: string, next: ConnectionStatus) {
    const prev = connectionStatuses.get(workspaceID)
    if (prev === next) return
    connectionStatuses.set(workspaceID, next)
    WorkspaceDB.updateState(workspaceID, { status: next })
    void Bus.publish(Event.Status, { workspaceID, status: next }).catch(() => undefined)
  }

  function syncDirectory(space: Info) {
    if (space.config.type === "worktree") return
    return space.config.directory
  }

  async function mirrorWorkspaceEvent(space: Info, event: { type?: string; properties?: any }) {
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

  function rememberWorkspaceEvent(workspaceID: string, event: { type?: string; properties?: any }) {
    if (!event?.type || event.type === "server.heartbeat") return
    if (!RESTORE_EVENT_TYPES.has(event.type)) return
    WorkspaceDB.appendEvent(workspaceID, event)
  }

  function startSpaceSync(space: Info) {
    if (space.config.type === "worktree") return
    if (syncControllers.has(space.id)) return
    // Atomic check-and-set using starting mutex
    if (startingSync.has(space.id)) return
    startingSync.add(space.id)

    const stop = new AbortController()
    syncControllers.set(space.id, stop)

    void workspaceEventLoop(space, stop.signal)
      .catch((error) => {
        log.warn("workspace sync listener failed", {
          workspaceID: space.id,
          error,
        })
      })
      .finally(() => {
        if (syncControllers.get(space.id) === stop) syncControllers.delete(space.id)
        startingSync.delete(space.id)
      })
  }

  function stopSpaceSync(id: string) {
    const controller = syncControllers.get(id)
    if (!controller) return
    controller.abort()
    syncControllers.delete(id)
  }

  export const create = fn(
    Schema.Struct({
      id: Schema.optional(Identifier.schemaEffect("workspace")),
      projectID: Schema.String,
      branch: Schema.NullOr(Schema.String),
      config: ConfigSchema,
    }),
    async (input) => {
      const id = Identifier.ascending("workspace", input.id)

      const { config, init } = await getAdaptor(input.config).create(input.config, input.branch, id)

      const info: Info = {
        id,
        projectID: input.projectID,
        branch: input.branch,
        config,
      }

      let previousInfo: WorkspaceDB.Info | undefined
      let previousState: WorkspaceDB.State | undefined
      let wroteDB = false

      try {
        await init()
        await WorkspaceDB.migrateFromStorage()
        previousInfo = WorkspaceDB.get(id)
        previousState = previousInfo ? WorkspaceDB.getState(id) : undefined
        WorkspaceDB.upsert(info)
        wroteDB = true
        WorkspaceDB.updateState(id, {
          status: info.config.type === "worktree" ? "connected" : "connecting",
          events: [],
          eventLimit: info.config.eventLimit,
        })
        startSpaceSync(info)
      } catch (error) {
        stopSpaceSync(id)
        if (wroteDB) {
          if (previousInfo) {
            WorkspaceDB.upsert(previousInfo)
            if (previousState) WorkspaceDB.updateState(id, previousState)
          } else {
            WorkspaceDB.remove(id)
          }
        }
        SandboxRegistry.invalidateWorkspace(id)
        connectionStatuses.delete(id)
        await getAdaptor(config)
          .remove(config)
          .catch((cleanupError) => {
            log.warn("workspace create cleanup failed", {
              workspaceID: id,
              error: cleanupError,
            })
          })
        throw error
      }

      GlobalBus.emit("event", {
        directory: id,
        payload: {
          type: Event.Ready.type,
          properties: {},
        },
      })

      return info
    },
  )

  export async function list(project: Project.Info) {
    await WorkspaceDB.migrateFromStorage()
    return WorkspaceDB.list(project.id).map(fromRow)
  }

  export const get = fn(Identifier.schemaEffect("workspace"), async (id) => {
    await WorkspaceDB.migrateFromStorage()
    const row = WorkspaceDB.get(id)
    return row ? fromRow(row) : undefined
  })

  export const sandbox = fn(Identifier.schemaEffect("workspace"), async (id) => {
    const info = await get(id)
    if (!info) return undefined
    return SandboxRegistry.resolve({
      type: "workspace",
      workspaceID: info.id,
    })
  })

  export const target = fn(Identifier.schemaEffect("workspace"), async (id) => {
    const resolved = await sandbox(id)
    if (!resolved) return undefined
    return resolved.target()
  })

  export const remove = fn(Identifier.schemaEffect("workspace"), async (id) => {
    const info = await get(id)
    if (info) {
      stopSpaceSync(id)
      await getAdaptor(info.config).remove(info.config)
      WorkspaceDB.remove(id)
      SandboxRegistry.invalidateWorkspace(id)
      connectionStatuses.delete(id)
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    const target = await Workspace.target(space.id)

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
          rememberWorkspaceEvent(space.id, payload)
          void mirrorWorkspaceEvent(space, payload).catch((error) => {
            log.warn("workspace event mirror failed", {
              workspaceID: space.id,
              error,
              type: payload?.type,
            })
          })
          GlobalBus.emit("event", {
            directory: space.id,
            payload,
          })
        })
        if (!stop.aborted) setStatus(space.id, "disconnected")
        await Bun.sleep(250)
      }
    } finally {
      setStatus(space.id, "disconnected")
    }
  }

  export function startSyncing(project: Project.Info) {
    void (async () => {
      const spaces = (await list(project)).filter((space) => space.config.type !== "worktree")
      spaces.forEach(startSpaceSync)
    })()

    return {
      async stop() {
        const spaces = await list(project)
        spaces.forEach((space) => stopSpaceSync(space.id))
      },
    }
  }

  export function stopAllSyncing() {
    for (const id of [...syncControllers.keys()]) {
      stopSpaceSync(id)
    }
  }

  // Cleanup global state on process exit
  function cleanup() {
    log.info("cleanup: stopping all workspace sync loops")
    stopAllSyncing()
    connectionStatuses.clear()
  }
  process.on("beforeExit", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("SIGINT", cleanup)

  /**
   * Ensures the workspace's event sync loop is running and resolves once the
   * workspace reports `connected` (or rejects on timeout / abort).
   * For local workspaces the promise resolves immediately.
   */
  export const restore = fn(
    Schema.Struct({
      workspaceID: Identifier.schemaEffect("workspace"),
      timeoutMs: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)), {
        default: () => 30_000,
      }),
      signal: Schema.optional(Schema.Any),
    }),
    async ({ workspaceID, timeoutMs, signal }) => {
      const info = await get(workspaceID)
      if (!info) throw new Storage.NotFoundError({ message: `Workspace not found: ${workspaceID}` })
      if (info.config.type === "worktree") {
        setStatus(workspaceID, "connected")
        return buildRestorePayload(workspaceID)
      }
      startSpaceSync(info)
      const currentStatus = connectionStatuses.get(workspaceID)
      if (currentStatus === "connected") return buildRestorePayload(workspaceID)
      if (currentStatus === "error") {
        throw new Error(`Workspace failed to connect: ${workspaceID}`)
      }
      const { EventLoop } = await import("@/util/eventloop")
      const settled = await EventLoop.waitEvent({
        event: Event.Status,
        timeoutMs,
        signal: signal as AbortSignal | undefined,
        predicate: (p) => p.workspaceID === workspaceID && (p.status === "connected" || p.status === "error"),
      })
      if (settled.status !== "connected") {
        throw new Error(`Workspace failed to connect: ${workspaceID}`)
      }
      return buildRestorePayload(workspaceID)
    },
  )

  export const sessionRestore = fn(
    Schema.Struct({
      workspaceID: Identifier.schemaEffect("workspace"),
      sessionID: Identifier.schemaEffect("session"),
      timeoutMs: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)), {
        default: () => 30_000,
      }),
      signal: Schema.optional(Schema.Any),
    }),
    async ({ workspaceID, sessionID, timeoutMs, signal }) => {
      await restore({ workspaceID, timeoutMs, signal })
      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          yield* session.update(sessionID, (draft) => {
            draft.workspaceID = workspaceID
          })
        }),
      )
      const payload = await buildRestorePayload(workspaceID)
      return {
        ...payload,
        sessionID,
      }
    },
  )
}
