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
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { getAdaptor } from "./adaptors"
import { Config, ConfigSchema } from "./config"
import { parseSSE } from "./sse"
import { SandboxRegistry } from "@/sandbox/registry"
import { WorkspaceDB } from "./db"
import { zod, zodObject } from "@/util/effect-zod"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
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
  const ConnectionStatusSchema = Schema.Literals(["connecting", "connected", "disconnected", "error"])
  export const ConnectionStatus = zod(ConnectionStatusSchema)
  export type ConnectionStatus = Schema.Schema.Type<typeof ConnectionStatusSchema>

  export const Event = {
    Ready: BusEvent.define(
      "workspace.ready",
      z.object({
        name: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "workspace.failed",
      z.object({
        message: z.string(),
      }),
    ),
    Status: BusEvent.define(
      "workspace.status",
      z.object({
        workspaceID: Identifier.schema("workspace"),
        status: ConnectionStatus,
      }),
    ),
  }

  const InfoSchema = Schema.Struct({
    id: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    branch: Schema.NullOr(Schema.String),
    projectID: Schema.String,
    config: ConfigSchema,
  }).annotate({ identifier: "Workspace" })
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
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    sessions: Schema.Array(Schema.String).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<string>)),
    ),
    events: Schema.Array(Schema.Unknown).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<unknown>)),
    ),
  }).annotate({ identifier: "Workspace.Restore" })
  export const Restore = zodObject(RestoreSchema)
  export type Restore = Schema.Schema.Type<typeof RestoreSchema>

  const SessionRestoreSchema = Schema.Struct({
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    sessions: Schema.Array(Schema.String).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<string>)),
    ),
    events: Schema.Array(Schema.Unknown).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<unknown>)),
    ),
    sessionID: Schema.String.pipe(Schema.check(Schema.isStartsWith("ses"))),
  }).annotate({ identifier: "Workspace.SessionRestore" })
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

  function eventSessionID(event: { properties?: any }) {
    const properties = event.properties
    if (!properties || typeof properties !== "object") return
    if (typeof properties.sessionID === "string") return properties.sessionID
    if (typeof properties.info?.id === "string" && properties.info.id.startsWith("ses")) return properties.info.id
    if (typeof properties.info?.sessionID === "string") return properties.info.sessionID
    if (typeof properties.part?.sessionID === "string") return properties.part.sessionID
  }

  function eventWorkspaceID(event: { properties?: any }) {
    const workspaceID = event.properties?.info?.workspaceID
    return typeof workspaceID === "string" ? workspaceID : undefined
  }

  async function acceptsWorkspaceEvent(workspaceID: string, event: { type?: string; properties?: any }) {
    if (!event?.type || event.type === "server.heartbeat") return false
    const declaredWorkspaceID = eventWorkspaceID(event)
    if (declaredWorkspaceID && declaredWorkspaceID !== workspaceID) return false

    const sessionID = eventSessionID(event)
    if (!sessionID) return true

    const session = await runSession(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        return yield* sessions.getAnyProject(sessionID)
      }),
    ).catch(() => undefined)

    if (!session) return declaredWorkspaceID === undefined || declaredWorkspaceID === workspaceID
    return session.workspaceID === workspaceID
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
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: Info.shape.projectID,
      branch: Info.shape.branch,
      config: Info.shape.config,
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

  export const get = fn(Identifier.schema("workspace"), async (id) => {
    await WorkspaceDB.migrateFromStorage()
    const row = WorkspaceDB.get(id)
    return row ? fromRow(row) : undefined
  })

  export const sandbox = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id)
    if (!info) return undefined
    return SandboxRegistry.resolve({
      type: "workspace",
      workspaceID: info.id,
    })
  })

  export const target = fn(Identifier.schema("workspace"), async (id) => {
    const resolved = await sandbox(id)
    if (!resolved) return undefined
    return resolved.target()
  })

  export const remove = fn(Identifier.schema("workspace"), async (id) => {
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
          void acceptsWorkspaceEvent(space.id, payload)
            .then((accepted) => {
              if (!accepted) return
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
            .catch((error) => {
              log.warn("workspace event ownership check failed", {
                workspaceID: space.id,
                error,
                type: payload?.type,
              })
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
    z.object({
      workspaceID: Identifier.schema("workspace"),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
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
    z.object({
      workspaceID: Identifier.schema("workspace"),
      sessionID: Identifier.schema("session"),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
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

  /**
   * Move a session between workspaces, or detach it back to the local project.
   * Pass `workspaceID: null` to clear the session's workspaceID.
   */
  export const sessionWarp = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      workspaceID: z.union([Identifier.schema("workspace"), z.null()]),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
    }),
    async ({ sessionID, workspaceID, timeoutMs, signal }) => {
      const current = await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          return yield* session.getAnyProject(sessionID)
        }),
      )

      if (current.workspaceID) {
        const previous = await get(current.workspaceID)
        if (previous?.config.type !== "worktree") {
          if (previous) {
            await restore({ workspaceID: previous.id, timeoutMs, signal }).catch((error) => {
              log.warn("session warp final source sync failed", {
                workspaceID: previous.id,
                sessionID,
                error,
              })
            })
          } else {
            await runSessionPrompt(
              Effect.gen(function* () {
                const prompt = yield* SessionPrompt.Service
                yield* prompt.cancel(sessionID)
              }),
            )
          }
        } else {
          await runSessionPrompt(
            Effect.gen(function* () {
              const prompt = yield* SessionPrompt.Service
              yield* prompt.cancel(sessionID)
            }),
          )
        }
      } else {
        await runSessionPrompt(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            yield* prompt.cancel(sessionID)
          }),
        )
      }

      const target = workspaceID
        ? await restore({ workspaceID, timeoutMs, signal }).then(() => targetWorkspace(workspaceID))
        : undefined

      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          yield* session.update(sessionID, (draft) => {
            draft.workspaceID = workspaceID ?? undefined
          })
        }),
      )

      if (workspaceID && target?.type === "remote") {
        const headers = new Headers(target.headers)
        headers.set("content-type", "application/json")
        headers.set("x-nikcli-workspace", workspaceID)
        const response = await fetch(new URL("/sync/steal", target.url), {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionID }),
          signal,
        })
        if (!response.ok) {
          const body = await response.text().catch(() => "")
          throw new Error(`Failed to warp session into workspace ${workspaceID}: HTTP ${response.status} ${body}`)
        }
      }

      return {
        sessionID,
        workspaceID: workspaceID ?? null,
      }
    },
  )

  async function targetWorkspace(workspaceID: string) {
    const info = await get(workspaceID)
    if (!info) throw new Storage.NotFoundError({ message: `Workspace not found: ${workspaceID}` })
    return Workspace.target(info.id)
  }
}
