import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  ConnectorStatus,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  FileDiff,
  Workspace,
} from "@nikcli-ai/sdk/v2"
import type { Config } from "@nikcli-ai/sdk/v2/client"
import { createNikcliClient } from "@nikcli-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { useProject } from "@tui/context/project"
import { Binary } from "@nikcli-ai/util/binary"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onCleanup, onMount } from "solid-js"
import { debounce } from "@solid-primitives/scheduled"
import { Log } from "@/util/log"
import { createLru } from "@tui/util/lru-cache"
import { createLatestOnlyAsync } from "@tui/util/signal"
import type { Path } from "@nikcli-ai/sdk/v2"
import { features } from "@/config/features"

type BackgroundJob = {
  jobID: string
  rootDelegationID: string
  parentSessionID: string
  title: string
  agent: string
  status: "running" | "synthesizing" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
  source?: string
  workerSessionID?: string
  delegatorID?: string
  delegatorSessionID?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  lastActivityAt?: number
  progressSummary?: string
  resultSummary?: string
  error?: string
}

type GoalState = {
  sessionID: string
  goalID: string
  objective: string
  status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete"
  tokenBudget?: number
  tokensUsed: number
  timeUsedSeconds: number
  iterationCount: number
  timeCreated: number
  timeUpdated: number
}

type MonitorSnapshot = {
  id: string
  title: string
  command: string
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | string
  logPath?: string
  exitCode?: number
  preview?: string
  bytes?: number
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      config: Config
      permission: Record<string, PermissionRequest[]>
      question: Record<string, QuestionRequest[]>
      session: Session[]
      session_status: Record<string, SessionStatus>
      session_goal: Record<string, GoalState>
      background_job: Record<string, BackgroundJob[]>
      monitor: Record<string, MonitorSnapshot[]>
      session_diff: Record<string, FileDiff[]>
      todo: Record<string, Todo[]>
      message: Record<string, Message[]>
      part: Record<string, Part[]>
      lsp: LspStatus[]
      mcp: Record<string, McpStatus>
      mcp_resource: Record<string, McpResource>
      connectors: Record<string, ConnectorStatus>
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
      workspaceList: Workspace[]
    }>({
      status: "loading",
      provider: [],
      provider_default: {},
      provider_next: { all: [], default: {}, connected: [] },
      provider_auth: {},
      agent: [],
      command: [],
      config: {} as Config,
      permission: {},
      question: {},
      session: [],
      session_status: {},
      session_goal: {},
      background_job: {},
      monitor: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      connectors: {},
      formatter: [],
      vcs: undefined,
      path: { home: "", state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })

    const sdk = useSDK()
    const project = useProject()
    const backgroundRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

    /** Client scoped to the currently selected workspace (opencode parity):
     *  when a workspace is active every bootstrap fetch runs against the
     *  worktree instance, so path/vcs/config/sessions reflect the worktree. */
    function scopedClient() {
      const workspace = project.workspace.current()
      if (!workspace) return sdk.client
      return createNikcliClient({
        baseUrl: sdk.url,
        fetch: sdk.fetch,
        directory: sdk.directory,
        workspace,
      })
    }

    const refreshLspLatest = createLatestOnlyAsync<[], Awaited<ReturnType<typeof sdk.client.lsp.status>>>(async () =>
      sdk.client.lsp.status(),
    )
    // Debounce rapid lsp.updated bursts (typing / file switches) so only the latest applies.
    // See specs/opencode-parity/03-request-throttling.md.
    const applyLspRefresh = () =>
      refreshLspLatest()
        .then((x) => {
          if (x?.data) setStore("lsp", reconcile(x.data))
        })
        .catch(() => {})
    const refreshLspDebounced = debounce(applyLspRefresh, 300)

    async function refreshBackgroundJobs(sessionID: string) {
      const result = await sdk.client.session.background({ sessionID }).catch(() => undefined)
      if (!result?.data) return
      setStore("background_job", sessionID, reconcile(result.data))
    }

    // Last delegationID we scheduled a refresh for, keyed by session.
    // This trims the "delegation.completed + 12 message.part.updated"
    // flood that follows a child completion: the first event schedules
    // the refresh; subsequent events for the same delegationID find
    // the existing timer and just extend the debounce window, so the
    // request fires once per delegation (per session) instead of once
    // per event. Entries are evicted on `session.deleted` below.
    const lastDelegationBySession = new Map<string, string>()

    function scheduleBackgroundRefresh(sessionID?: string, delegationID?: string) {
      if (!sessionID) return
      // If the caller passes the same delegationID we already scheduled
      // for, treat the call as a debounce extension rather than a new
      // refresh. The first event for a new delegationID still records
      // the lookup so subsequent retries for the same one are merged.
      if (delegationID) {
        const previous = lastDelegationBySession.get(sessionID)
        if (previous !== delegationID) lastDelegationBySession.set(sessionID, delegationID)
      }
      const existing = backgroundRefreshTimers.get(sessionID)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        backgroundRefreshTimers.delete(sessionID)
        void refreshBackgroundJobs(sessionID).catch(() => {})
      }, 75)
      backgroundRefreshTimers.set(sessionID, timer)
    }

    function monitorFromRecord(record: {
      id: string
      title: string
      command: string
      status: MonitorSnapshot["status"]
      logPath: string
      exitCode?: number
      preview?: string
      bytes?: number
    }): MonitorSnapshot {
      return {
        id: record.id,
        title: record.title,
        command: record.command,
        status: record.status,
        logPath: record.logPath,
        exitCode: record.exitCode,
        preview: record.preview,
        bytes: record.bytes,
      }
    }

    function upsertMonitor(sessionID: string, monitor: MonitorSnapshot) {
      const monitors = store.monitor[sessionID]
      if (!monitors) {
        setStore("monitor", sessionID, [monitor])
        return
      }
      const result = Binary.search(monitors, monitor.id, (m) => m.id)
      if (result.found) {
        setStore("monitor", sessionID, result.index, reconcile(monitor))
        return
      }
      setStore(
        "monitor",
        sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, monitor)
        }),
      )
    }

    function patchMonitor(sessionID: string, monitorID: string, patch: Partial<MonitorSnapshot>) {
      const monitors = store.monitor[sessionID]
      if (!monitors) return
      const result = Binary.search(monitors, monitorID, (m) => m.id)
      if (!result.found) return
      setStore("monitor", sessionID, result.index, reconcile({ ...monitors[result.index], ...patch }))
    }

    async function syncWorkspaces() {
      const result = await sdk.client.experimental.workspace.list().catch(() => undefined)
      if (!result?.data) return
      setStore("workspaceList", reconcile(result.data))
    }

    function getSessionByID(sessionID: string) {
      const match = Binary.search(store.session, sessionID, (s) => s.id)
      if (match.found) return store.session[match.index]
      return undefined
    }

    const applyEvent: Parameters<typeof sdk.event.listen>[0] = (e) => {
      const event = e.details
      switch (event.type) {
        // Note: InstanceDisposed events are handled explicitly by the caller
        // (e.g., ApiMethod, AutoMethod, CodeMethod) to avoid double-bootstrap.
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          syncedSessions.delete(event.properties.info.id)
          sessionLru.forget(event.properties.info.id)
          lastDelegationBySession.delete(event.properties.info.id)
          const messageIDs = (store.message[event.properties.info.id] ?? []).map((message) => message.id)
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          setStore(
            produce((draft) => {
              delete draft.message[event.properties.info.id]
              delete draft.todo[event.properties.info.id]
              delete draft.background_job[event.properties.info.id]
              delete draft.monitor[event.properties.info.id]
              delete draft.session_diff[event.properties.info.id]
              delete draft.session_status[event.properties.info.id]
              delete draft.session_goal[event.properties.info.id]
              for (const messageID of messageIDs) {
                delete draft.part[messageID]
              }
            }),
          )
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          const parentID = getSessionByID(event.properties.sessionID)?.parentID
          scheduleBackgroundRefresh(parentID)
          break
        }

        case "session.goal": {
          const { sessionID, goal } = event.properties
          if (goal) {
            setStore("session_goal", sessionID, reconcile(goal as GoalState))
          } else {
            setStore(
              produce((draft) => {
                delete draft.session_goal[sessionID]
              }),
            )
          }
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const refreshParentID = getSessionByID(event.properties.part.sessionID)?.parentID
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            scheduleBackgroundRefresh(refreshParentID)
            if (event.properties.part.type === "tool" && event.properties.part.tool === "task") {
              scheduleBackgroundRefresh(event.properties.part.sessionID)
            }
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            if (event.properties.part.type === "tool" && event.properties.part.tool === "task") {
              scheduleBackgroundRefresh(refreshParentID)
              scheduleBackgroundRefresh(event.properties.part.sessionID)
            }
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          scheduleBackgroundRefresh(refreshParentID)
          if (event.properties.part.type === "tool" && event.properties.part.tool === "task") {
            scheduleBackgroundRefresh(event.properties.part.sessionID)
          }
          break
        }

        case "delegation.completed": {
          // Pass the delegationID so the lastDelegationBySession
          // dedup can coalesce the burst of part.updated events that
          // typically follow a single completion.
          scheduleBackgroundRefresh(event.properties.parentSessionID, event.properties.delegationID)
          break
        }

        case "monitor.created": {
          upsertMonitor(event.properties.sessionID, monitorFromRecord(event.properties.record))
          break
        }

        case "monitor.updated": {
          upsertMonitor(event.properties.sessionID, monitorFromRecord(event.properties.record))
          break
        }

        case "monitor.output": {
          patchMonitor(event.properties.sessionID, event.properties.monitorID, {
            preview: event.properties.preview,
            bytes: event.properties.bytes,
            status: event.properties.status,
          })
          break
        }

        case "monitor.completed": {
          patchMonitor(event.properties.sessionID, event.properties.monitorID, {
            title: event.properties.title,
            status: event.properties.status,
            exitCode: event.properties.exitCode ?? undefined,
            logPath: event.properties.logPath,
          })
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          if (features(store.config).requests.latestOnlyLspRefresh) {
            refreshLspDebounced()
          } else {
            void sdk.client.lsp
              .status()
              .then((x) => setStore("lsp", x.data!))
              .catch(() => {})
          }
          break
        }
      }
    }

    // Backend events arrive in bursts while a turn streams; applying each one as it lands makes a
    // separate Solid update — and re-render — per event. Queue them and flush on a short timer
    // inside a single batch, preserving arrival order.
    const EVENT_FLUSH_MS = 10
    let queuedEvents: Array<Parameters<typeof applyEvent>[0]> = []
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    function flushEvents() {
      flushTimer = undefined
      if (queuedEvents.length === 0) return
      const pending = queuedEvents
      queuedEvents = []
      batch(() => {
        for (const event of pending) applyEvent(event)
      })
    }

    sdk.event.listen((e) => {
      queuedEvents.push(e)
      flushTimer ??= setTimeout(flushEvents, EVENT_FLUSH_MS)
    })

    onCleanup(() => {
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      flushTimer = undefined
      queuedEvents = []
    })

    // vcs.branch.updated is directory-scoped: with the global event stream we
    // receive branch updates from every instance (root + each worktree), so
    // only apply the one matching the currently displayed scope.
    sdk.onEnvelope(({ directory, payload }) => {
      if (payload.type !== "vcs.branch.updated") return
      if (directory && store.path.directory && directory !== store.path.directory) return
      setStore("vcs", { branch: payload.properties.branch })
    })

    const { exit } = useExit()
    const args = useArgs()

    async function refreshProviders() {
      // Refresh provider data without clearing session state
      const [providerList, providerNext, providerAuth] = await Promise.all([
        sdk.client.config.providers({}, { throwOnError: true }),
        sdk.client.provider.list({}, { throwOnError: true }),
        sdk.client.provider.auth(),
      ])
      batch(() => {
        setStore("provider", reconcile(providerList.data!.providers))
        setStore("provider_default", reconcile(providerList.data!.default))
        setStore("provider_next", reconcile(providerNext.data!))
        setStore("provider_auth", reconcile(providerAuth.data ?? {}))
      })
    }

    let bootstrapVersion = 0

    async function bootstrap() {
      const version = ++bootstrapVersion
      const current = () => version === bootstrapVersion
      syncedSessions.clear()
      sessionLru.clear()
      setStore(
        produce((draft) => {
          draft.message = {}
          draft.part = {}
          draft.todo = {}
          draft.background_job = {}
          draft.monitor = {}
          draft.session_diff = {}
          draft.session_status = {}
          draft.session_goal = {}
        }),
      )
      // Scoped to the current workspace (if any) so switching workspaces
      // re-fetches path/vcs/config/agents/sessions from the worktree instance.
      const client = scopedClient()
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = client.session.list({ start: start }).then((x) => {
        if (current()) setStore("session", reconcile((x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id))))
      })

      // blocking - include session.list when continuing a session
      const blockingRequests: Promise<unknown>[] = [
        client.config.providers({}, { throwOnError: true }).then((x) => {
          if (!current()) return
          batch(() => {
            setStore("provider", reconcile(x.data!.providers))
            setStore("provider_default", reconcile(x.data!.default))
          })
        }),
        client.provider.list({}, { throwOnError: true }).then((x) => {
          if (!current()) return
          batch(() => {
            setStore("provider_next", reconcile(x.data!))
          })
        }),
        client.app
          .agents({}, { throwOnError: true })
          .then((x) => current() && setStore("agent", reconcile(x.data ?? []))),
        client.config.get({}, { throwOnError: true }).then((x) => current() && setStore("config", reconcile(x.data!))),
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          if (!current()) return
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise]),
            client.command.list().then((x) => current() && setStore("command", reconcile(x.data ?? []))),
            client.lsp.status().then((x) => current() && setStore("lsp", reconcile(x.data!))),
            client.mcp.status().then((x) => current() && setStore("mcp", reconcile(x.data!))),
            client.experimental.resource
              .list()
              .then((x) => current() && setStore("mcp_resource", reconcile(x.data ?? {}))),
            client.connectors.status().then((x) => current() && setStore("connectors", reconcile(x.data!))),
            client.formatter.status().then((x) => current() && setStore("formatter", reconcile(x.data!))),
            client.session.status().then((x) => {
              if (!current()) return
              setStore("session_status", reconcile(x.data!))
            }),
            client.provider.auth().then((x) => current() && setStore("provider_auth", reconcile(x.data ?? {}))),
            client.vcs.get().then((x) => current() && setStore("vcs", reconcile(x.data))),
            client.path.get().then((x) => current() && setStore("path", reconcile(x.data!))),
            project.sync(),
            syncWorkspaces(),
          ])
            .then(() => {
              if (!current()) return
              setStore("status", "complete")
            })
            .catch((e) => {
              if (!current()) return
              Log.Default.warn("tui bootstrap non-blocking refresh failed", {
                error: e instanceof Error ? e.message : String(e),
                name: e instanceof Error ? e.name : undefined,
              })
              if (store.status !== "complete") setStore("status", "partial")
            })
        })
        .catch(async (e) => {
          if (!current()) return
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

    const syncedSessions = new Map<string, "partial" | "full">()

    // Bound the heavy per-session maps the store accumulates during long session-hopping.
    // See specs/opencode-parity/02-tui-cache-eviction.md. The session being opened is touched
    // first (MRU) so it can never be a victim; sessions with active work, background jobs, or
    // that parent the active one are pinned. Re-opening an evicted session just re-runs sync().
    const sessionLru = createLru({ maxEntries: 25, ttlMs: 30 * 60_000 })
    function reapSessions(activeSessionID: string) {
      if (!features(store.config).tui.cacheEviction) return

      sessionLru.touch(activeSessionID)

      const pinned = new Set<string>([activeSessionID])
      const parentID = getSessionByID(activeSessionID)?.parentID
      if (parentID) pinned.add(parentID)
      for (const [sid, status] of Object.entries(store.session_status)) {
        if (status && status.type !== "idle") pinned.add(sid)
      }
      for (const sid of Object.keys(store.background_job)) {
        if ((store.background_job[sid] ?? []).length > 0) pinned.add(sid)
      }
      for (const sid of Object.keys(store.monitor)) {
        if ((store.monitor[sid] ?? []).some((m) => m.status === "running")) pinned.add(sid)
      }

      // evictExpired() is not pinning-aware, so re-touch any pinned-but-expired session to keep
      // it resident (e.g. a long-running streaming session with sparse events) and exclude all
      // pinned sessions from the final eviction set.
      const expired = sessionLru.evictExpired()
      for (const sid of expired) if (pinned.has(sid)) sessionLru.touch(sid)
      const evicted = [...new Set([...expired, ...sessionLru.evictOverflow(pinned)])].filter((sid) => !pinned.has(sid))
      if (evicted.length === 0) return
      setStore(
        produce((draft) => {
          for (const sid of evicted) {
            for (const message of draft.message[sid] ?? []) delete draft.part[message.id]
            delete draft.message[sid]
            delete draft.session_diff[sid]
            delete draft.todo[sid]
          }
        }),
      )
      for (const sid of evicted) syncedSessions.delete(sid)
    }

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string, options?: { full?: boolean }) {
          // Refresh recency for the session being viewed (even on cache hit) and evict
          // least-recently-used sessions beyond the cap. The active session is MRU -> safe.
          reapSessions(sessionID)
          const mode = options?.full ? "full" : "partial"
          const existing = syncedSessions.get(sessionID)
          if (existing === "full" || existing === mode) return result.session.get(sessionID)
          const [session, messages, todo, diff, backgroundJobs, goal] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages(options?.full ? { sessionID } : { sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
            sdk.client.session.background({ sessionID }).catch(() => undefined),
            sdk.client.session.goal({ sessionID }).catch(() => undefined),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.background_job[sessionID] = backgroundJobs?.data ?? []
              draft.message[sessionID] = messages.data!.map((x) => x.info)
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
              if (goal?.data) draft.session_goal[sessionID] = goal.data as GoalState
              else delete draft.session_goal[sessionID]
            }),
          )
          syncedSessions.set(sessionID, mode === "full" ? "full" : "partial")
          return session.data
        },
        async refreshDiff(sessionID: string) {
          if (!sessionID) return []
          const diff = await sdk.client.session.diff({ sessionID })
          const files = diff.data ?? []
          setStore("session_diff", sessionID, files)
          return files
        },
      },
      background: {
        list(sessionID: string) {
          return store.background_job[sessionID] ?? []
        },
        get(sessionID: string, delegationID: string) {
          return (store.background_job[sessionID] ?? []).find((job) => job.rootDelegationID === delegationID)
        },
        findBySession(sessionID: string) {
          for (const jobs of Object.values(store.background_job)) {
            const match = jobs.find((job) => job.workerSessionID === sessionID || job.delegatorSessionID === sessionID)
            if (match) return match
          }
          return undefined
        },
        sync: refreshBackgroundJobs,
      },
      workspace: {
        get(workspaceID: string) {
          return store.workspaceList.find((workspace) => workspace.id === workspaceID)
        },
        sync: syncWorkspaces,
      },
      bootstrap,
      refreshProviders,
    }
    return result
  },
})
