/**
 * nikcli Herdr integration — server-side bridge.
 *
 * Reports nikcli session lifecycle state (working/idle/blocked) to a Herdr
 * pane via Herdr's Unix socket API. The bridge is auto-enabled when the
 * `HERDR_ENV=1` environment is set (set by a Herdr pane that wraps the
 * nikcli process) and a `HERDR_SOCKET_PATH` / `HERDR_PANE_ID` is published.
 * If either is missing — i.e. nikcli is running outside Herdr — the bridge
 * is a hard no-op, mirroring the Prime Agent / `prime-agent` built-in
 * extension shape.
 *
 * Design notes (matches the in-tree pattern documented in
 * https://github.com/PrimeIntellect-ai/prime-agent/commit/ecd3290):
 *
 *   - All work happens on a single `node:net` socket, never via fetch or
 *     REST. Herdr's socket is a JSON-lines NDJSON protocol; we open one
 *     socket per request and close it on the first response, so the
 *     bridge can never hold a stale socket when herdr restarts.
 *
 *   - `pane.report_agent` is guarded by herdr with a per-source monotonic
 *     `seq`. Stale or low-seq reports are dropped silently. We therefore
 *     keep a process-wide `seq` counter that never regresses: every new
 *     value is `max(prev+1, Date.now()*1000)`. This is what protects the
 *     bridge against `/new`, `/resume`, `/fork`, and `/reload`, all of
 *     which re-instantiate the reporter inside the same pane.
 *
 *   - Subagent sessions never own the pane. A child session's events can
 *     still project state (a subagent asking for permission blocks the
 *     pane) but never replace the pane's root conversation ref, so a
 *     subagent finishing can't release a pane whose parent is still live.
 *
 *   - The bridge is fully lazy. The global bus listener is only attached
 *     when `setEnabled(true)` is called (e.g. by the TUI plugin's toggle
 *     command) — never on import. This protects the chat session stream
 *     from being hooked while the user has no pane registered.
 */
import { spawnSync } from "node:child_process"
import { createConnection, type NetConnectOpts, type Socket } from "node:net"
import { platform } from "node:os"
import fs from "fs/promises"
import { homedir } from "os"
import path from "path"
import { z } from "zod"
import { GlobalBus } from "./global-bus"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "herdr-bridge" })

/**
 * Canonical identity we report under. Herdr keys agent authority by
 * `source`, so this string is the integration's identity: it must match
 * the `HERDR_INTEGRATION_ID` used by the standalone plugin file
 * (`scripts/herdr-agent-state.js`) that `herdr integration install`
 * would drop into `~/.config/nikcli/plugin/`. Herdr's own integrations
 * use the same `herdr:<agent>` shape (`herdr:opencode`, `herdr:claude`).
 */
export const HERDR_SOURCE = "herdr:nikcli"
export const HERDR_AGENT = "nikcli"

/**
 * Herdr's `PaneAgentState` enum. `done` is *not* a reportable state —
 * herdr derives it itself from an idle agent whose tab was never seen —
 * so anything that looks "finished" on our side is reported as `idle`.
 */
const REPORTABLE_STATES = new Set(["idle", "working", "blocked", "unknown"])

function toReportableState(state: HerdrAgentState): string {
  if (state === "done") return "idle"
  return REPORTABLE_STATES.has(state) ? state : "unknown"
}

/**
 * One JSON-line socket request. Matches the format herdr's
 * `session.snapshot`, `pane.report_agent`, `pane.report_agent_session` and
 * `pane.release_agent` endpoints accept (see https://herdr.dev/docs/socket-api/).
 */
export type HerdrRequest = {
  id: string
  method: string
  params?: Record<string, unknown>
}

export type HerdrResponse = {
  id?: string
  result?: unknown
  error?: { code?: string; message?: string }
  /** Response kind herdr tags the payload with. */
  type?: string
}

export type HerdrAgentState = "idle" | "working" | "blocked" | "done" | "unknown"

export type HerdrWorkspace = {
  id: string
  label?: string
  focused?: boolean
  cwd?: string
  worktree?: { branch: string; path?: string }
}

export type HerdrTab = {
  id: string
  workspaceId: string
  label?: string
  focused?: boolean
}

export type HerdrPane = {
  id: string
  workspaceId: string
  tabId: string
  label?: string
  focused?: boolean
  /** Semantic agent state herdr sees for this pane. */
  agentStatus?: HerdrAgentState
  /** Foreground process name (shell, claude, codex, etc.). */
  foreground?: string
}

export type HerdrAgent = {
  id: string
  workspaceId: string
  tabId: string
  paneId: string
  /** What the agent says it is (claude, codex, opencode, …). */
  agent?: string
  state?: HerdrAgentState
  source?: string
  message?: string
}

export type HerdrSnapshot = {
  /** ISO timestamp of the last full snapshot we successfully loaded. */
  takenAt: string
  version?: string
  protocolVersion?: number
  focusedWorkspaceId?: string
  focusedTabId?: string
  focusedPaneId?: string
  workspaces: HerdrWorkspace[]
  tabs: HerdrTab[]
  panes: HerdrPane[]
  agents: HerdrAgent[]
}

export type HerdrInstallInfo = {
  /** True when the `herdr` binary is reachable on PATH. */
  installed: boolean
  /** Resolved binary path, or `undefined` when not installed. */
  binPath?: string
  /** True when the bridge can reach a running herdr server. */
  serverRunning: boolean
  /** Resolved socket path the bridge is connected to, when running. */
  socketPath?: string
}

const DefaultState: HerdrSnapshot = {
  takenAt: "",
  workspaces: [],
  tabs: [],
  panes: [],
  agents: [],
}

type Runtime = {
  /** Per-instance state, keyed by project directory. */
  snapshots: Map<string, HerdrSnapshot>
  /** True when the bus listener has actually been attached to GlobalBus. */
  busListenerInstalled: boolean
  /** True when the bridge is enabled for the current process. */
  enabled: boolean
  /** Local socket file used in tests, when we can't reach a real herdr. */
  testSocketPath?: string
  /** True when this instance has been released; late reports are dropped. */
  released: boolean
  /**
   * Last root session id we attached to a herdr report. Herdr uses it to
   * resume the pane into its native conversation after a server restart
   * (`session.resume_agents_on_restore`), so it must always track the
   * pane's *root* session, never a subagent's.
   */
  reportedRootSessionID?: string
  /**
   * Subagent / child sessions seen in this process. Their events project
   * state (a child asking for permission still blocks the pane) but never
   * replace the pane's root session id.
   */
  childSessions: Set<string>
}

const runtime: Runtime = {
  snapshots: new Map(),
  busListenerInstalled: false,
  enabled: false,
  released: false,
  childSessions: new Set(),
}

/**
 * Herdr accepts one request per connection and orders reports by `seq`.
 * Firing two sockets concurrently lets a lower-seq report land last, so
 * every write goes through a single serialized chain — the same shape
 * herdr's own opencode plugin uses.
 */
let requestChain: Promise<unknown> = Promise.resolve()

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const pending = requestChain.then(fn, fn)
  requestChain = pending.catch(() => {})
  return pending
}

/**
 * Force the bridge to talk to a user-provided socket path instead of the
 * real herdr server. Only used by tests; production reads
 * `HERDR_SOCKET_PATH` and the per-platform default location.
 */
export function setTestSocketPath(value: string | undefined) {
  runtime.testSocketPath = value
}

function defaultSocketPath(): string {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH
  const base = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config")
  return path.join(base, "herdr", "herdr.sock")
}

export function resolveSocketPath(): string {
  return runtime.testSocketPath ?? defaultSocketPath()
}

/**
 * Build the `net.createConnection` argument for the current OS.
 *
 * Node's `createConnection(path)` overload treats the string as a TCP host
 * (`port: 0`), which on macOS/Linux silently tries to resolve a hostname
 * and never opens the Unix socket. Unix sockets need `{ path }`. Windows
 * named pipes need `{ host: "\\\\.\\pipe", port: socketPath }`.
 *
 * Keeping the cross-platform dance here means the rest of the bridge can
 * stay OS-agnostic.
 */
function socketOptions(socketPath: string): NetConnectOpts {
  if (platform() === "win32") {
    // Named pipes on Windows go through the host/port combination.
    // Node's `NetConnectOpts.port` is typed as `number`; for pipes we
    // cast through `unknown` because the actual transport doesn't care —
    // the OS dispatches by host+port where the port slot is the pipe
    // name string. This is the same shape the Node docs use for `net`
    // IPC over a named pipe.
    return { host: "\\\\.\\pipe", port: socketPath as unknown as number }
  }
  return { path: socketPath }
}

function openSocket(socketPath: string): Socket {
  return createConnection(socketOptions(socketPath))
}

/**
 * Resolve the `herdr` binary by walking PATH. We avoid `Bun.which` here on
 * purpose: we want a non-throwing check that returns undefined instead of
 * throwing, since some sandboxes throw rather than return null.
 */
export function resolveHerdrBin(): string | undefined {
  const explicit = process.env.HERDR_BIN_PATH
  if (explicit && explicit.length > 0) return explicit
  if (typeof Bun === "undefined" || typeof Bun.which !== "function") return undefined
  try {
    return Bun.which("herdr") ?? undefined
  } catch {
    return undefined
  }
}

async function probeSocket(socketPath: string, timeoutMs = 750): Promise<boolean> {
  try {
    const stat = await Promise.race([
      fs.stat(socketPath),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("probe timeout")), timeoutMs)),
    ])
    return stat.isSocket() || stat.isFile() || stat.isFIFO()
  } catch {
    return false
  }
}

/**
 * Public API: discover whether herdr is installed and whether a server is
 * running. The bridge is idempotent and cheap to call on every status read.
 */
export async function detect(): Promise<HerdrInstallInfo> {
  const binPath = resolveHerdrBin()
  const socketPath = resolveSocketPath()
  const serverRunning = await probeSocket(socketPath)
  return {
    installed: Boolean(binPath),
    binPath,
    serverRunning,
    socketPath: serverRunning ? socketPath : undefined,
  }
}

/**
 * Send a single request/response on a fresh socket. Used for one-shot
 * queries (`session.snapshot`). Throws on connection failure, protocol
 * error, or timeout. The bridge everywhere catches and logs these so a
 * flaky herdr server never crashes nikcli.
 */
export async function call<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 5000,
  options?: { socketPath?: string },
): Promise<T> {
  const socketPath = options?.socketPath ?? resolveSocketPath()
  const id = `nikcli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // Herdr's protocol rejects requests without a `params` field, so we
  // always send at least an empty object — `JSON.stringify` would otherwise
  // drop the key when the caller passes `undefined`.
  const req: HerdrRequest = { id, method, params: params ?? {} }
  return new Promise<T>((resolve, reject) => {
    let buffer = ""
    let settled = false
    const finish = (ok: boolean, value: T | Error) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {}
      if (ok) resolve(value as T)
      else reject(value as Error)
    }
    const timer = setTimeout(
      () => finish(false, new Error(`herdr ${method} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    const socket: Socket = openSocket(socketPath)
    socket.on("error", (error) => finish(false, error))
    socket.on("connect", () => {
      try {
        socket.write(JSON.stringify(req) + "\n")
      } catch (error) {
        finish(false, error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.on("data", (data) => {
      buffer += data.toString("utf8")
      let idx = buffer.indexOf("\n")
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) {
          try {
            const parsed = JSON.parse(line) as HerdrResponse
            if (parsed.id !== id) {
              idx = buffer.indexOf("\n")
              continue
            }
            clearTimeout(timer)
            if (parsed.error) {
              finish(false, new Error(parsed.error.message ?? parsed.error.code ?? "unknown herdr error"))
              return
            }
            finish(true, parsed.result as T)
            return
          } catch (error) {
            clearTimeout(timer)
            finish(false, error instanceof Error ? error : new Error(String(error)))
            return
          }
        }
        idx = buffer.indexOf("\n")
      }
    })
    socket.on("close", () => {
      if (!settled) finish(false, new Error("herdr socket closed before reply"))
    })
  })
}

/**
 * Public snapshot accessor. Returns the cached snapshot for the current
 * project directory, or an empty snapshot when the bridge has never seen
 * herdr. We key per-directory so multi-project nikcli instances don't
 * clobber each other.
 */
export function snapshot(directory?: string): HerdrSnapshot {
  const key = directory ?? process.cwd()
  return runtime.snapshots.get(key) ?? { ...DefaultState }
}

export function setSnapshot(directory: string, next: HerdrSnapshot) {
  runtime.snapshots.set(directory, next)
}

/**
 * Per-source monotonic seq counter. Herdr's `pane.report_agent` rejects
 * any report with a `seq` <= the latest accepted seq for the same source;
 * if we ever restarted the counter, herdr would silently drop the new
 * agent's reports and the pane would stick at "working".
 *
 * Multi-instance safety: this is a module-level counter shared across all
 * bridge instances in the process. The `Math.max(prev+1, Date.now()*1000)`
 * clamp guarantees we never regress, even when the host reloads.
 */
let reportSeq = Date.now() * 1000

export function nextReportSeq(): number {
  reportSeq = Math.max(reportSeq + 1, Date.now() * 1000)
  return reportSeq
}

/**
 * True when the bridge is running inside a Herdr pane. Honors HERDR_ENV=1
 * plus a socket path and pane id published by the wrapping Herdr server.
 *
 * Outside this gate, every bridge method is a no-op — so the bridge can
 * safely live in the same process as the chat stream.
 */
export function isInHerdrPane(): boolean {
  return (
    process.env["HERDR_ENV"] === "1" &&
    Boolean(process.env["HERDR_SOCKET_PATH"]) &&
    Boolean(process.env["HERDR_PANE_ID"])
  )
}

/**
 * Send a `pane.report_agent` request and return its promise. The bridge
 * always uses the HERDR_PANE_ID, HERDR_SOCKET_PATH, and source label
 * "herdr:nikcli" so the wrapping Herdr server recognises the pane as a
 * first-class agent.
 */
export async function reportAgent(input: {
  state: HerdrAgentState
  message?: string
  seq?: number
  paneId?: string
  socketPath?: string
  source?: string
  agent?: string
  /** nikcli session id herdr should resume this pane into. */
  sessionID?: string
}) {
  if (!runtime.enabled) return { ok: false as const, reason: "disabled" as const }
  if (runtime.released) return { ok: false as const, reason: "released" as const }
  const socketPath = input.socketPath ?? process.env["HERDR_SOCKET_PATH"]
  const paneId = input.paneId ?? process.env["HERDR_PANE_ID"]
  if (!socketPath || !paneId) return { ok: false as const, reason: "no-pane" as const }
  if (input.sessionID) runtime.reportedRootSessionID = input.sessionID
  return serialize(async () => {
    const seq = input.seq ?? nextReportSeq()
    try {
      await call(
        "pane.report_agent",
        {
          pane_id: paneId,
          source: input.source ?? HERDR_SOURCE,
          agent: input.agent ?? HERDR_AGENT,
          state: toReportableState(input.state),
          message: input.message,
          agent_session_id: input.sessionID,
          seq,
        },
        1500,
        { socketPath },
      )
      return { ok: true as const, seq }
    } catch (error) {
      log.debug("herdr report_agent failed", { error: errorMessage(error) })
      return { ok: false as const, reason: "error" as const, error }
    }
  })
}

/**
 * Publish the pane's conversation reference without changing its state.
 *
 * This is what makes nikcli an "official" herdr integration rather than a
 * status reporter: herdr persists the session ref and — with
 * `session.resume_agents_on_restore` — relaunches the pane straight back
 * into that nikcli session after a server restart.
 *
 * `startSource: "new"` tells herdr the pane genuinely started a new
 * conversation, so it replaces the stored ref instead of treating the
 * change as cross-talk from another session sharing the process.
 */
export async function reportAgentSession(input: {
  sessionID: string
  startSource?: string
  paneId?: string
  socketPath?: string
  source?: string
  agent?: string
}) {
  if (!runtime.enabled) return { ok: false as const, reason: "disabled" as const }
  if (runtime.released) return { ok: false as const, reason: "released" as const }
  if (!input.sessionID) return { ok: false as const, reason: "no-session" as const }
  const socketPath = input.socketPath ?? process.env["HERDR_SOCKET_PATH"]
  const paneId = input.paneId ?? process.env["HERDR_PANE_ID"]
  if (!socketPath || !paneId) return { ok: false as const, reason: "no-pane" as const }
  runtime.reportedRootSessionID = input.sessionID
  return serialize(async () => {
    const seq = nextReportSeq()
    try {
      await call(
        "pane.report_agent_session",
        {
          pane_id: paneId,
          source: input.source ?? HERDR_SOURCE,
          agent: input.agent ?? HERDR_AGENT,
          agent_session_id: input.sessionID,
          session_start_source: input.startSource,
          seq,
        },
        1500,
        { socketPath },
      )
      return { ok: true as const, seq }
    } catch (error) {
      log.debug("herdr report_agent_session failed", {
        error: errorMessage(error),
      })
      return { ok: false as const, reason: "error" as const, error }
    }
  })
}

/**
 * Release the pane. Called only on real quit (not on session replacement),
 * so the successor instance in the same pane can re-report without race.
 */
export async function releasePane(input?: { paneId?: string; socketPath?: string }) {
  const socketPath = input?.socketPath ?? process.env["HERDR_SOCKET_PATH"]
  const paneId = input?.paneId ?? process.env["HERDR_PANE_ID"]
  if (!socketPath || !paneId) return { ok: false as const, reason: "no-pane" as const }
  runtime.released = true
  return serialize(async () => {
    try {
      await call(
        "pane.release_agent",
        {
          pane_id: paneId,
          source: HERDR_SOURCE,
          agent: HERDR_AGENT,
          seq: nextReportSeq(),
        },
        1500,
        { socketPath },
      )
      return { ok: true as const }
    } catch (error) {
      log.debug("herdr release_agent failed", { error: errorMessage(error) })
      return { ok: false as const, reason: "error" as const, error }
    }
  })
}

/**
 * Release the pane without an event loop.
 *
 * Herdr keeps a reported agent until someone releases it — it only clears
 * agents it recognizes by process, and nikcli is not one of those, so a
 * quit that skips the release leaves a zombie row in herdr's agent panel
 * until the pane's shell itself exits. `process.on("exit")` cannot await a
 * socket write, so the shutdown path goes through the herdr CLI instead,
 * which is synchronous.
 */
export function releaseAgentArgv(paneId: string, seq: number): string[] {
  return ["pane", "release-agent", paneId, "--source", HERDR_SOURCE, "--agent", HERDR_AGENT, "--seq", String(seq)]
}

export function releasePaneSync(): void {
  if (runtime.released) return
  const paneId = process.env["HERDR_PANE_ID"]
  const bin = resolveHerdrBin()
  if (!paneId || !bin) return
  runtime.released = true
  try {
    spawnSync(bin, releaseAgentArgv(paneId, nextReportSeq()), {
      stdio: "ignore",
      timeout: 2000,
      windowsHide: true,
    })
  } catch (error) {
    log.debug("herdr release_agent (cli) failed", { error: errorMessage(error) })
  }
}

/**
 * Report a nikcli session as a herdr agent. No-op when the bridge is not
 * enabled or the socket is unreachable. Failures are logged, never thrown,
 * so a flaky herdr can't affect the session lifecycle.
 */
export async function reportSession(input: {
  directory: string
  sessionID: string
  agent: string
  state: HerdrAgentState
  message?: string
  paneId?: string
  source?: string
}) {
  return reportAgent({
    state: input.state,
    message: input.message,
    paneId: input.paneId,
    source: input.source,
    agent: input.agent,
    sessionID: input.sessionID,
  })
}

/**
 * Release our authority over a nikcli-backed pane. Called when a session
 * ends so herdr doesn't keep a zombie "working" agent around.
 */
export async function releaseSession(input: { directory: string; sessionID: string; agent: string; paneId?: string }) {
  if (!runtime.enabled) return { ok: false as const, reason: "disabled" as const }
  return releasePane({ paneId: input.paneId })
}

/**
 * Current install / connection status. Single-call convenience for the
 * status panel — does not throw on a missing server.
 */
export async function status(): Promise<
  HerdrInstallInfo & {
    enabled: boolean
    inHerdrPane: boolean
  }
> {
  const info = await detect()
  return {
    ...info,
    enabled: runtime.enabled,
    inHerdrPane: isInHerdrPane(),
  }
}

/**
 * Toggle bridging for this process. Mirrors IslandBridge.setEnabled so
 * the TUI plugin can flip the bridge on/off per session.
 *
 * The bridge is intentionally lazy: the bus listener is only registered
 * the first time the user explicitly enables it. Before that, the bridge
 * is a hard no-op — no socket probe, no global listener, no overhead.
 * This is critical because the plugin's runtime lives in the same
 * process as the chat stream; a stray subscriber previously interfered
 * with the chat's session pipeline.
 */
export function setEnabled(next: boolean) {
  if (runtime.enabled === next) return
  runtime.enabled = next
  if (next) ensureBusListener()
}

export function isEnabled() {
  return runtime.enabled
}

/**
 * Mark the bridge as released. Used by the host to skip late reports
 * (e.g. after a real quit) so the pane never accidentally reclaims a
 * stale agent.
 */
export function setReleased(value: boolean) {
  runtime.released = value
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * nikcli session status → herdr state. Kept as a map (rather than the
 * narrower typed union) because the bus carries
 * status strings from several producers; an unrecognized status means
 * "no state change", not "idle".
 */
const SESSION_STATE_BY_STATUS = new Map<string, HerdrAgentState>([
  ["idle", "idle"],
  ["active", "working"],
  ["busy", "working"],
  ["pending", "working"],
  ["retry", "working"],
  ["running", "working"],
  ["streaming", "working"],
  ["working", "working"],
])

function stateFromSessionStatus(status: unknown): HerdrAgentState | undefined {
  const kind = typeof status === "string" ? status : (status as { type?: unknown } | undefined)?.type
  if (typeof kind !== "string") return undefined
  return SESSION_STATE_BY_STATUS.get(kind.toLowerCase())
}

/** Child-session events that still project onto the pane's state. */
const CHILD_EVENT_STATES = new Map<string, HerdrAgentState>([
  ["permission.asked", "blocked"],
  ["question.asked", "blocked"],
  ["permission.replied", "working"],
  ["question.replied", "working"],
  ["question.rejected", "working"],
])

function sessionIDFrom(properties: any): string | undefined {
  const direct = properties?.sessionID
  if (typeof direct === "string" && direct) return direct
  const info = properties?.info?.id
  return typeof info === "string" && info ? info : undefined
}

/**
 * Translate one nikcli bus event into herdr reports.
 *
 * Mirrors the plugin herdr installs for opencode (`herdr integration
 * install opencode`) one-for-one, so a nikcli pane behaves exactly like
 * any first-party agent in the sidebar, the attention queue, and
 * `herdr agent wait`.
 *
 * Exported so both the bus listener and a host that forwards the plugin
 * `event` hook can drive it.
 */
export function handleEvent(event: { type?: string; properties?: any }): Promise<unknown> {
  if (!runtime.enabled) return Promise.resolve()
  const type = event?.type
  if (!type) return Promise.resolve()
  const properties = event.properties ?? {}
  const sessionID = sessionIDFrom(properties)

  // A session with a parent is a subagent: remember it so its own
  // lifecycle can never overwrite the pane's root conversation ref.
  const info = properties.info
  if (info?.id && info.parentID) runtime.childSessions.add(info.id)

  if (sessionID && runtime.childSessions.has(sessionID)) {
    const state = CHILD_EVENT_STATES.get(type)
    // Reported without a session id — the subagent is blocking the pane,
    // but the pane still belongs to the parent conversation.
    return state ? reportState(state) : Promise.resolve()
  }

  switch (type) {
    case "session.created":
      // A root session.created is a genuine new-conversation start
      // (subagent creates were filtered above), so herdr should replace
      // whatever session ref the pane held.
      return reportAgentSession({ sessionID: sessionID!, startSource: "new" })
    case "session.updated":
      if (sessionID && sessionID !== runtime.reportedRootSessionID) return reportAgentSession({ sessionID })
      return Promise.resolve()
    case "session.status": {
      const state = stateFromSessionStatus(properties.status)
      if (state) return reportState(state, sessionID)
      return sessionID ? reportAgentSession({ sessionID }) : Promise.resolve()
    }
    case "tool.execute.before":
    case "tool.execute.after":
    case "permission.replied":
    case "question.replied":
    case "question.rejected":
    case "session.compacted":
      return reportState("working", sessionID)
    case "permission.asked":
    case "question.asked":
    case "session.error":
      return reportState("blocked", sessionID)
    case "session.idle":
      return reportState("idle", sessionID)
    default:
      return Promise.resolve()
  }
}

/**
 * Report the pane as working because the user just sent a prompt. Wired
 * to the plugin's `chat.message` hook, which fires before the first
 * `session.status` busy event.
 */
export function handleChatMessage(sessionID?: string): Promise<unknown> {
  if (!runtime.enabled) return Promise.resolve()
  if (sessionID && runtime.childSessions.has(sessionID)) return Promise.resolve()
  return reportState("working", sessionID)
}

/** Report a state on the current pane, optionally carrying a session ref. */
export function reportState(state: HerdrAgentState, sessionID?: string, message?: string): Promise<unknown> {
  return reportAgent({ state, sessionID, message }).catch(() => undefined)
}

/**
 * Idempotent: registers the bus listener exactly once per process, even
 * if the bridge is toggled off and on again. Called only from
 * `setEnabled(true)` — the bridge does NOT auto-wire itself on import
 * (intentional, see setEnabled's doc).
 */
function ensureBusListener() {
  if (runtime.busListenerInstalled) return
  runtime.busListenerInstalled = true
  GlobalBus.on("event", ({ payload }) => {
    if (!runtime.enabled) return
    handleEvent(payload).catch(() => {})
  })
}

/**
 * Optional explicit hook for callers that want to register the listener
 * ahead of time (e.g. when running `nikcli serve` for a hosted setup).
 * Most users should call `setEnabled(true)` instead.
 */
export function start(): void {
  ensureBusListener()
}

/**
 * Public schema for the nikcli side of herdr snapshots — defined here so
 * the TUI plugin and the server API endpoint can share it without one
 * importing the other's runtime code.
 */
export const HerdrSnapshotSchema = z.object({
  takenAt: z.string(),
  version: z.string().optional(),
  protocolVersion: z.number().int().optional(),
  focusedWorkspaceId: z.string().optional(),
  focusedTabId: z.string().optional(),
  focusedPaneId: z.string().optional(),
  workspaces: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      focused: z.boolean().optional(),
      cwd: z.string().optional(),
      worktree: z
        .object({
          branch: z.string(),
          path: z.string().optional(),
        })
        .optional(),
    }),
  ),
  tabs: z.array(
    z.object({
      id: z.string(),
      workspaceId: z.string(),
      label: z.string().optional(),
      focused: z.boolean().optional(),
    }),
  ),
  panes: z.array(
    z.object({
      id: z.string(),
      workspaceId: z.string(),
      tabId: z.string(),
      label: z.string().optional(),
      focused: z.boolean().optional(),
      agentStatus: z.enum(["idle", "working", "blocked", "done", "unknown"]).optional(),
      foreground: z.string().optional(),
    }),
  ),
  agents: z.array(
    z.object({
      id: z.string(),
      workspaceId: z.string(),
      tabId: z.string(),
      paneId: z.string(),
      agent: z.string().optional(),
      state: z.enum(["idle", "working", "blocked", "done", "unknown"]).optional(),
      source: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
})

export type HerdrSnapshotWire = z.infer<typeof HerdrSnapshotSchema>

/**
 * Convert a raw herdr `session.snapshot` response into our normalized
 * snapshot. Picked apart manually rather than letting zod handle the whole
 * shape, because herdr's actual payload can contain extra fields we don't
 * care about — we want a strict, narrow contract at this boundary.
 */
export function normalizeSnapshot(raw: unknown): HerdrSnapshot {
  const fallback: HerdrSnapshot = {
    ...DefaultState,
    takenAt: new Date().toISOString(),
  }
  if (!raw || typeof raw !== "object") return fallback
  const root = raw as Record<string, unknown>
  const version = typeof root.version === "string" ? root.version : undefined
  const protocolVersion = typeof root.protocol_version === "number" ? root.protocol_version : undefined
  const focused = (root.focused as Record<string, unknown> | undefined) ?? {}
  const focusedWorkspaceId = typeof focused.workspace_id === "string" ? focused.workspace_id : undefined
  const focusedTabId = typeof focused.tab_id === "string" ? focused.tab_id : undefined
  const focusedPaneId = typeof focused.pane_id === "string" ? focused.pane_id : undefined
  const workspaces = Array.isArray(root.workspaces)
    ? (root.workspaces as Array<Record<string, unknown>>).map((w) => ({
        id: String(w.id ?? w.workspace_id ?? ""),
        label: typeof w.label === "string" ? w.label : undefined,
        focused: Boolean(w.focused),
        cwd: typeof w.cwd === "string" ? w.cwd : undefined,
        worktree:
          w.worktree && typeof w.worktree === "object"
            ? {
                branch: String((w.worktree as Record<string, unknown>).branch ?? ""),
                path:
                  typeof (w.worktree as Record<string, unknown>).path === "string"
                    ? ((w.worktree as Record<string, unknown>).path as string)
                    : undefined,
              }
            : undefined,
      }))
    : []
  const tabs = Array.isArray(root.tabs)
    ? (root.tabs as Array<Record<string, unknown>>).map((t) => ({
        id: String(t.id ?? t.tab_id ?? ""),
        workspaceId: String(t.workspace_id ?? ""),
        label: typeof t.label === "string" ? t.label : undefined,
        focused: Boolean(t.focused),
      }))
    : []
  const panes = Array.isArray(root.panes)
    ? (root.panes as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id ?? p.pane_id ?? ""),
        workspaceId: String(p.workspace_id ?? ""),
        tabId: String(p.tab_id ?? ""),
        label: typeof p.label === "string" ? p.label : undefined,
        focused: Boolean(p.focused),
        agentStatus: typeof p.agent_status === "string" ? (p.agent_status as HerdrAgentState) : undefined,
        foreground: typeof p.foreground === "string" ? p.foreground : undefined,
      }))
    : []
  const agents = Array.isArray(root.agents)
    ? (root.agents as Array<Record<string, unknown>>).map((a) => ({
        id: String(a.id ?? a.agent_id ?? ""),
        workspaceId: String(a.workspace_id ?? ""),
        tabId: String(a.tab_id ?? ""),
        paneId: String(a.pane_id ?? ""),
        agent: typeof a.agent === "string" ? a.agent : undefined,
        state: typeof a.state === "string" ? (a.state as HerdrAgentState) : undefined,
        source: typeof a.source === "string" ? a.source : undefined,
        message: typeof a.message === "string" ? a.message : undefined,
      }))
    : []
  return {
    takenAt: new Date().toISOString(),
    version,
    protocolVersion,
    focusedWorkspaceId,
    focusedTabId,
    focusedPaneId,
    workspaces,
    tabs,
    panes,
    agents,
  }
}

/**
 * Fetch a fresh snapshot from the running herdr server and cache it. Safe
 * to call repeatedly; the TUI uses this to keep the panel fresh.
 */
export async function refresh(directory: string): Promise<HerdrSnapshot> {
  const info = await detect()
  if (!info.serverRunning) return snapshot(directory)
  try {
    const raw = await call<unknown>("session.snapshot", undefined, 3000)
    // Herdr wraps the snapshot in a `result.snapshot` envelope; the
    // sibling `type` is informational. Unwrap before normalizing so we
    // never end up parsing a `type: "session_snapshot"` blob.
    const inner = (raw as { snapshot?: unknown } | null | undefined)?.snapshot ?? raw
    const next = normalizeSnapshot(inner)
    setSnapshot(directory, next)
    return next
  } catch (error) {
    log.debug("herdr refresh failed", { error: errorMessage(error) })
    return snapshot(directory)
  }
}

/**
 * Best-effort cleanup; called when the TUI plugin is deactivated or the
 * process is shutting down. Detaches reporting and clears cached state.
 */
export function stop(): void {
  setEnabled(false)
  runtime.snapshots.clear()
  runtime.reportedRootSessionID = undefined
  runtime.childSessions.clear()
  runtime.released = false
}

/**
 * Re-export the bridge as a namespace, mirroring IslandBridge. The TUI
 * plugin imports this so its commands can read status / toggle the bridge
 * without binding to a separate object.
 */
export const HerdrBridge = {
  start,
  stop,
  refresh,
  setEnabled,
  isEnabled,
  detect,
  snapshot,
  setSnapshot,
  status,
  reportSession,
  releaseSession,
  reportAgent,
  reportAgentSession,
  reportState,
  handleEvent,
  handleChatMessage,
  releasePane,
  releasePaneSync,
  isInHerdrPane,
  nextReportSeq,
  normalizeSnapshot,
  setReleased,
  setTestSocketPath,
  resolveSocketPath,
  resolveHerdrBin,
  call,
} as const
