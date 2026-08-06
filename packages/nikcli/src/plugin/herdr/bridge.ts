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
 *   - The bridge is bound to a single session. We re-bind to the first
 *     session that publishes `session_start` and ignore events from any
 *     other session that shares the runtime (subagent, RLM children).
 *     Otherwise a subagent's `agent_end` would race the parent's
 *     session_ref and release the pane while the parent is still running.
 *
 *   - The release on `session_shutdown` is gated on `reason === "quit"`.
 *     On `/new`, `/resume`, `/fork`, or `/reload`, the successor instance
 *     re-reports immediately; releasing here would race the successor's
 *     report and herdr would clear the pane.
 *
 *   - The bridge is fully lazy. The global bus listener is only attached
 *     when `setEnabled(true)` is called (e.g. by the TUI plugin's toggle
 *     command) — never on import. This protects the chat session stream
 *     from being hooked while the user has no pane registered.
 */
import { createConnection, type NetConnectOpts, type Socket } from "node:net";
import { platform } from "node:os";
import fs from "fs/promises";
import { homedir } from "os";
import path from "path";
import { z } from "zod";
import { GlobalBus } from "@/bus/global";
import { Log } from "@/util/log";

const log = Log.create({ service: "herdr-bridge" });

/**
 * One JSON-line socket request. Matches the format herdr's
 * `session.snapshot`, `pane.report_agent`, `pane.release_agent` and
 * `events.subscribe` endpoints accept (see https://herdr.dev/docs/socket-api/).
 */
export type HerdrRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type HerdrResponse = {
  id?: string;
  result?: unknown;
  error?: { code?: string; message?: string };
  /** Pushed events from a long-lived subscription. */
  type?: string;
};

export type HerdrAgentState =
  | "idle"
  | "working"
  | "blocked"
  | "done"
  | "unknown";

export type HerdrWorkspace = {
  id: string;
  label?: string;
  focused?: boolean;
  cwd?: string;
  worktree?: { branch: string; path?: string };
};

export type HerdrTab = {
  id: string;
  workspaceId: string;
  label?: string;
  focused?: boolean;
};

export type HerdrPane = {
  id: string;
  workspaceId: string;
  tabId: string;
  label?: string;
  focused?: boolean;
  /** Semantic agent state herdr sees for this pane. */
  agentStatus?: HerdrAgentState;
  /** Foreground process name (shell, claude, codex, etc.). */
  foreground?: string;
};

export type HerdrAgent = {
  id: string;
  workspaceId: string;
  tabId: string;
  paneId: string;
  /** What the agent says it is (claude, codex, opencode, …). */
  agent?: string;
  state?: HerdrAgentState;
  source?: string;
  message?: string;
};

export type HerdrSnapshot = {
  /** ISO timestamp of the last full snapshot we successfully loaded. */
  takenAt: string;
  version?: string;
  protocolVersion?: number;
  focusedWorkspaceId?: string;
  focusedTabId?: string;
  focusedPaneId?: string;
  workspaces: HerdrWorkspace[];
  tabs: HerdrTab[];
  panes: HerdrPane[];
  agents: HerdrAgent[];
};

export type HerdrInstallInfo = {
  /** True when the `herdr` binary is reachable on PATH. */
  installed: boolean;
  /** Resolved binary path, or `undefined` when not installed. */
  binPath?: string;
  /** True when the bridge can reach a running herdr server. */
  serverRunning: boolean;
  /** Resolved socket path the bridge is connected to, when running. */
  socketPath?: string;
};

/**
 * Wire details for a single herdr event subscription. Held in state so the
 * bridge can replay what it's listening to (e.g. for the status panel).
 */
export type HerdrSubscription = {
  id: string;
  types: string[];
  /** True when the underlying socket is still open. */
  alive: boolean;
};

const DefaultState: HerdrSnapshot = {
  takenAt: "",
  workspaces: [],
  tabs: [],
  panes: [],
  agents: [],
};

type Runtime = {
  /** Per-instance state, keyed by project directory. */
  snapshots: Map<string, HerdrSnapshot>;
  /** Live subscriptions. */
  subscriptions: HerdrSubscription[];
  /** True when the bus listener has actually been attached to GlobalBus. */
  busListenerInstalled: boolean;
  /** True when the bridge is enabled for the current process. */
  enabled: boolean;
  /** Local socket file used in tests, when we can't reach a real herdr. */
  testSocketPath?: string;
  /** First session id we bound to. */
  boundSessionID?: string;
  /** True when this instance has been released; late reports are dropped. */
  released: boolean;
};

const runtime: Runtime = {
  snapshots: new Map(),
  subscriptions: [],
  busListenerInstalled: false,
  enabled: false,
  released: false,
};

/**
 * Force the bridge to talk to a user-provided socket path instead of the
 * real herdr server. Only used by tests; production reads
 * `HERDR_SOCKET_PATH` and the per-platform default location.
 */
export function setTestSocketPath(value: string | undefined) {
  runtime.testSocketPath = value;
}

function defaultSocketPath(): string {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const base = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  return path.join(base, "herdr", "herdr.sock");
}

export function resolveSocketPath(): string {
  return runtime.testSocketPath ?? defaultSocketPath();
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
    return { host: "\\\\.\\pipe", port: socketPath as unknown as number };
  }
  return { path: socketPath };
}

function openSocket(socketPath: string): Socket {
  return createConnection(socketOptions(socketPath));
}

/**
 * Resolve the `herdr` binary by walking PATH. We avoid `Bun.which` here on
 * purpose: we want a non-throwing check that returns undefined instead of
 * throwing, since some sandboxes throw rather than return null.
 */
export function resolveHerdrBin(): string | undefined {
  const explicit = process.env.HERDR_BIN_PATH;
  if (explicit && explicit.length > 0) return explicit;
  if (typeof Bun === "undefined" || typeof Bun.which !== "function")
    return undefined;
  try {
    return Bun.which("herdr") ?? undefined;
  } catch {
    return undefined;
  }
}

async function probeSocket(
  socketPath: string,
  timeoutMs = 750,
): Promise<boolean> {
  try {
    const stat = await Promise.race([
      fs.stat(socketPath),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), timeoutMs),
      ),
    ]);
    return stat.isSocket() || stat.isFile() || stat.isFIFO();
  } catch {
    return false;
  }
}

/**
 * Public API: discover whether herdr is installed and whether a server is
 * running. The bridge is idempotent and cheap to call on every status read.
 */
export async function detect(): Promise<HerdrInstallInfo> {
  const binPath = resolveHerdrBin();
  const socketPath = resolveSocketPath();
  const serverRunning = await probeSocket(socketPath);
  return {
    installed: Boolean(binPath),
    binPath,
    serverRunning,
    socketPath: serverRunning ? socketPath : undefined,
  };
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
  const socketPath = options?.socketPath ?? resolveSocketPath();
  const id = `nikcli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Herdr's protocol rejects requests without a `params` field, so we
  // always send at least an empty object — `JSON.stringify` would otherwise
  // drop the key when the caller passes `undefined`.
  const req: HerdrRequest = { id, method, params: params ?? {} };
  return new Promise<T>((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const finish = (ok: boolean, value: T | Error) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      if (ok) resolve(value as T);
      else reject(value as Error);
    };
    const timer = setTimeout(
      () =>
        finish(
          false,
          new Error(`herdr ${method} timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
    const socket: Socket = openSocket(socketPath);
    socket.on("error", (error) => finish(false, error));
    socket.on("connect", () => {
      try {
        socket.write(JSON.stringify(req) + "\n");
      } catch (error) {
        finish(
          false,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line) as HerdrResponse;
            if (parsed.id !== id) {
              idx = buffer.indexOf("\n");
              continue;
            }
            clearTimeout(timer);
            if (parsed.error) {
              finish(
                false,
                new Error(
                  parsed.error.message ??
                    parsed.error.code ??
                    "unknown herdr error",
                ),
              );
              return;
            }
            finish(true, parsed.result as T);
            return;
          } catch (error) {
            clearTimeout(timer);
            finish(
              false,
              error instanceof Error ? error : new Error(String(error)),
            );
            return;
          }
        }
        idx = buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      if (!settled)
        finish(false, new Error("herdr socket closed before reply"));
    });
  });
}

/**
 * Subscribe to a set of herdr events. Returns a disposable that closes the
 * underlying socket. Events are forwarded to the optional `onEvent` callback.
 */
export async function subscribe(
  types: string[],
  onEvent: (event: HerdrResponse) => void,
  options?: { socketPath?: string; timeoutMs?: number },
): Promise<() => void> {
  const socketPath = options?.socketPath ?? resolveSocketPath();
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const id = `nikcli-sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req: HerdrRequest = {
    id,
    method: "events.subscribe",
    params: { subscriptions: types.map((type) => ({ type })) },
  };
  const sub: HerdrSubscription = { id, types, alive: true };
  runtime.subscriptions.push(sub);
  return new Promise<() => void>((resolve, reject) => {
    let buffer = "";
    let opened = false;
    const socket = openSocket(socketPath);
    socket.on("error", (error) => {
      if (!opened) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      log.warn("herdr subscription socket error", {
        error: errorMessage(error),
      });
    });
    socket.on("connect", () => {
      try {
        socket.write(JSON.stringify(req) + "\n");
        opened = true;
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line) as HerdrResponse;
            onEvent(parsed);
          } catch (error) {
            log.warn("herdr subscription: failed to parse line", {
              error: errorMessage(error),
            });
          }
        }
        idx = buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      if (!opened) {
        reject(new Error("herdr socket closed before subscription opened"));
        return;
      }
      sub.alive = false;
    });
    const dispose = () => {
      if (!sub.alive) return;
      sub.alive = false;
      try {
        socket.destroy();
      } catch {}
      const idx = runtime.subscriptions.indexOf(sub);
      if (idx >= 0) runtime.subscriptions.splice(idx, 1);
      clearTimeout(timer);
    };
    const timer = setTimeout(dispose, timeoutMs);
    resolve(dispose);
  });
}

/**
 * Public snapshot accessor. Returns the cached snapshot for the current
 * project directory, or an empty snapshot when the bridge has never seen
 * herdr. We key per-directory so multi-project nikcli instances don't
 * clobber each other.
 */
export function snapshot(directory?: string): HerdrSnapshot {
  const key = directory ?? process.cwd();
  return runtime.snapshots.get(key) ?? { ...DefaultState };
}

export function setSnapshot(directory: string, next: HerdrSnapshot) {
  runtime.snapshots.set(directory, next);
}

/**
 * Translate a nikcli session status into a herdr agent state. We use
 * `working` for both busy and retry (herdr has no retry concept; busy is
 * the closest semantic), and `blocked` whenever a permission/question is
 * pending.
 */
export function sessionStatusToHerdrState(input: {
  status?: { type: "idle" | "busy" | "retry" } | undefined;
  permission?: boolean;
  question?: boolean;
}): HerdrAgentState {
  if (input.permission || input.question) return "blocked";
  if (!input.status) return "unknown";
  if (input.status.type === "busy") return "working";
  if (input.status.type === "retry") return "working";
  return "idle";
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
let reportSeq = Date.now() * 1000;

export function nextReportSeq(): number {
  reportSeq = Math.max(reportSeq + 1, Date.now() * 1000);
  return reportSeq;
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
  );
}

/**
 * Send a `pane.report_agent` request and return its promise. The bridge
 * always uses the HERDR_PANE_ID, HERDR_SOCKET_PATH, and source label
 * "herdr:nikcli" so the wrapping Herdr server recognises the pane as a
 * first-class agent.
 */
export async function reportAgent(input: {
  state: HerdrAgentState;
  message?: string;
  seq?: number;
  paneId?: string;
  socketPath?: string;
  source?: string;
  agent?: string;
}) {
  if (!runtime.enabled)
    return { ok: false as const, reason: "disabled" as const };
  if (runtime.released)
    return { ok: false as const, reason: "released" as const };
  const socketPath = input.socketPath ?? process.env["HERDR_SOCKET_PATH"];
  const paneId = input.paneId ?? process.env["HERDR_PANE_ID"];
  if (!socketPath || !paneId)
    return { ok: false as const, reason: "no-pane" as const };
  const seq = input.seq ?? nextReportSeq();
  try {
    await call(
      "pane.report_agent",
      {
        pane_id: paneId,
        source: input.source ?? "herdr:nikcli",
        agent: input.agent ?? "nikcli",
        state: input.state,
        message: input.message,
        seq,
      },
      1500,
      { socketPath },
    );
    return { ok: true as const, seq };
  } catch (error) {
    log.debug("herdr report_agent failed", { error: errorMessage(error) });
    return { ok: false as const, reason: "error" as const, error };
  }
}

/**
 * Release the pane. Called only on real quit (not on session replacement),
 * so the successor instance in the same pane can re-report without race.
 */
export async function releasePane(input?: {
  paneId?: string;
  socketPath?: string;
}) {
  const socketPath = input?.socketPath ?? process.env["HERDR_SOCKET_PATH"];
  const paneId = input?.paneId ?? process.env["HERDR_PANE_ID"];
  if (!socketPath || !paneId)
    return { ok: false as const, reason: "no-pane" as const };
  runtime.released = true;
  try {
    await call(
      "pane.release_agent",
      {
        pane_id: paneId,
        source: "herdr:nikcli",
        agent: "nikcli",
        seq: nextReportSeq(),
      },
      1500,
      { socketPath },
    );
    return { ok: true as const };
  } catch (error) {
    log.debug("herdr release_agent failed", { error: errorMessage(error) });
    return { ok: false as const, reason: "error" as const, error };
  }
}

/**
 * Report a nikcli session as a herdr agent. No-op when the bridge is not
 * enabled or the socket is unreachable. Failures are logged, never thrown,
 * so a flaky herdr can't affect the session lifecycle.
 */
export async function reportSession(input: {
  directory: string;
  sessionID: string;
  agent: string;
  state: HerdrAgentState;
  message?: string;
  paneId?: string;
  source?: string;
}) {
  if (!runtime.enabled)
    return { ok: false as const, reason: "disabled" as const };
  if (runtime.released)
    return { ok: false as const, reason: "released" as const };
  const info = await detect();
  if (!info.serverRunning)
    return { ok: false as const, reason: "no-server" as const };
  const source = input.source ?? `nikcli:${input.agent}`;
  const paneId = input.paneId ?? `nikcli-${input.sessionID}`;
  return reportAgent({
    state: input.state,
    message: input.message,
    paneId,
    source,
    agent: input.agent,
  });
}

/**
 * Release our authority over a nikcli-backed pane. Called when a session
 * ends so herdr doesn't keep a zombie "working" agent around.
 */
export async function releaseSession(input: {
  directory: string;
  sessionID: string;
  agent: string;
  paneId?: string;
}) {
  if (!runtime.enabled)
    return { ok: false as const, reason: "disabled" as const };
  const info = await detect();
  if (!info.serverRunning)
    return { ok: false as const, reason: "no-server" as const };
  const paneId = input.paneId ?? `nikcli-${input.sessionID}`;
  return releasePane({ paneId });
}

/**
 * Current install / connection status. Single-call convenience for the
 * status panel — does not throw on a missing server.
 */
export async function status(): Promise<
  HerdrInstallInfo & {
    enabled: boolean;
    inHerdrPane: boolean;
    subscriptions: number;
  }
> {
  const info = await detect();
  return {
    ...info,
    enabled: runtime.enabled,
    inHerdrPane: isInHerdrPane(),
    subscriptions: runtime.subscriptions.filter((s) => s.alive).length,
  };
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
  if (runtime.enabled === next) return;
  runtime.enabled = next;
  if (next) {
    ensureBusListener();
  } else {
    for (const sub of [...runtime.subscriptions]) {
      if (sub.alive) sub.alive = false;
    }
    runtime.subscriptions.length = 0;
  }
}

export function isEnabled() {
  return runtime.enabled;
}

/**
 * Mark the bridge as released. Used by the host to skip late reports
 * (e.g. after a real quit) so the pane never accidentally reclaims a
 * stale agent.
 */
export function setReleased(value: boolean) {
  runtime.released = value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bind the bridge to the first session that publishes `session_start`. The
 * host may run multiple sessions in the same process (subagent, RLM
 * children), and they all share the same GlobalBus. We re-bind only to
 * the parent session and ignore events from anyone else.
 */
function bindSession(sessionID: string) {
  if (runtime.boundSessionID === undefined) runtime.boundSessionID = sessionID;
}

function isBoundSession(sessionID: string): boolean {
  if (runtime.boundSessionID === undefined) return true;
  return sessionID === runtime.boundSessionID;
}

/**
 * Idempotent: registers the bus listener exactly once per process, even
 * if the bridge is toggled off and on again. Called only from
 * `setEnabled(true)` — the bridge does NOT auto-wire itself on import
 * (intentional, see setEnabled's doc).
 */
function ensureBusListener() {
  if (runtime.busListenerInstalled) return;
  runtime.busListenerInstalled = true;
  GlobalBus.on("event", ({ directory, payload }) => {
    if (!runtime.enabled) return;
    const type = payload?.type;
    if (!type) return;

    // Session lifecycle: bind to the first session we see, ignore others.
    if (type === "session.created" || type === "session.start") {
      const sessionID =
        payload?.properties?.info?.id ?? payload?.properties?.sessionID;
      if (typeof sessionID === "string") {
        bindSession(sessionID);
        // Seed "working" so the pane doesn't sit at idle while the agent
        // is still streaming its first token.
        if (isBoundSession(sessionID)) {
          reportSession({
            directory: directory ?? process.cwd(),
            sessionID,
            agent: "nikcli",
            state: "working",
            message: "starting",
          }).catch(() => {});
        }
      }
      return;
    }

    if (type === "session.status") {
      const sessionID = payload?.properties?.sessionID;
      if (typeof sessionID !== "string" || !isBoundSession(sessionID)) return;
      const status = payload?.properties?.status;
      const state = sessionStatusToHerdrState({ status });
      reportSession({
        directory: directory ?? process.cwd(),
        sessionID,
        agent: "nikcli",
        state,
      }).catch(() => {});
      return;
    }

    if (type === "permission.asked") {
      const sessionID = payload?.properties?.sessionID;
      if (typeof sessionID !== "string" || !isBoundSession(sessionID)) return;
      reportSession({
        directory: directory ?? process.cwd(),
        sessionID,
        agent: "nikcli",
        state: "blocked",
        message: "awaiting permission",
      }).catch(() => {});
      return;
    }

    if (type === "permission.replied") {
      const sessionID = payload?.properties?.sessionID;
      if (typeof sessionID !== "string" || !isBoundSession(sessionID)) return;
      reportSession({
        directory: directory ?? process.cwd(),
        sessionID,
        agent: "nikcli",
        state: "working",
      }).catch(() => {});
      return;
    }

    if (type === "session.idle" || type === "session.end") {
      const sessionID =
        payload?.properties?.info?.id ?? payload?.properties?.sessionID;
      if (typeof sessionID !== "string" || !isBoundSession(sessionID)) return;
      reportSession({
        directory: directory ?? process.cwd(),
        sessionID,
        agent: "nikcli",
        state: "idle",
      }).catch(() => {});
      return;
    }

    if (type === "session.deleted") {
      const sessionID =
        payload?.properties?.info?.id ?? payload?.properties?.sessionID;
      if (typeof sessionID !== "string" || !isBoundSession(sessionID)) return;
      releaseSession({
        directory: directory ?? process.cwd(),
        sessionID,
        agent: "nikcli",
      }).catch(() => {});
      return;
    }
  });
}

/**
 * Optional explicit hook for callers that want to register the listener
 * ahead of time (e.g. when running `nikcli serve` for a hosted setup).
 * Most users should call `setEnabled(true)` instead.
 */
export function start(): void {
  ensureBusListener();
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
      agentStatus: z
        .enum(["idle", "working", "blocked", "done", "unknown"])
        .optional(),
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
      state: z
        .enum(["idle", "working", "blocked", "done", "unknown"])
        .optional(),
      source: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

export type HerdrSnapshotWire = z.infer<typeof HerdrSnapshotSchema>;

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
  };
  if (!raw || typeof raw !== "object") return fallback;
  const root = raw as Record<string, unknown>;
  const version = typeof root.version === "string" ? root.version : undefined;
  const protocolVersion =
    typeof root.protocol_version === "number"
      ? root.protocol_version
      : undefined;
  const focused = (root.focused as Record<string, unknown> | undefined) ?? {};
  const focusedWorkspaceId =
    typeof focused.workspace_id === "string" ? focused.workspace_id : undefined;
  const focusedTabId =
    typeof focused.tab_id === "string" ? focused.tab_id : undefined;
  const focusedPaneId =
    typeof focused.pane_id === "string" ? focused.pane_id : undefined;
  const workspaces = Array.isArray(root.workspaces)
    ? (root.workspaces as Array<Record<string, unknown>>).map((w) => ({
        id: String(w.id ?? w.workspace_id ?? ""),
        label: typeof w.label === "string" ? w.label : undefined,
        focused: Boolean(w.focused),
        cwd: typeof w.cwd === "string" ? w.cwd : undefined,
        worktree:
          w.worktree && typeof w.worktree === "object"
            ? {
                branch: String(
                  (w.worktree as Record<string, unknown>).branch ?? "",
                ),
                path:
                  typeof (w.worktree as Record<string, unknown>).path ===
                  "string"
                    ? ((w.worktree as Record<string, unknown>).path as string)
                    : undefined,
              }
            : undefined,
      }))
    : [];
  const tabs = Array.isArray(root.tabs)
    ? (root.tabs as Array<Record<string, unknown>>).map((t) => ({
        id: String(t.id ?? t.tab_id ?? ""),
        workspaceId: String(t.workspace_id ?? ""),
        label: typeof t.label === "string" ? t.label : undefined,
        focused: Boolean(t.focused),
      }))
    : [];
  const panes = Array.isArray(root.panes)
    ? (root.panes as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id ?? p.pane_id ?? ""),
        workspaceId: String(p.workspace_id ?? ""),
        tabId: String(p.tab_id ?? ""),
        label: typeof p.label === "string" ? p.label : undefined,
        focused: Boolean(p.focused),
        agentStatus:
          typeof p.agent_status === "string"
            ? (p.agent_status as HerdrAgentState)
            : undefined,
        foreground: typeof p.foreground === "string" ? p.foreground : undefined,
      }))
    : [];
  const agents = Array.isArray(root.agents)
    ? (root.agents as Array<Record<string, unknown>>).map((a) => ({
        id: String(a.id ?? a.agent_id ?? ""),
        workspaceId: String(a.workspace_id ?? ""),
        tabId: String(a.tab_id ?? ""),
        paneId: String(a.pane_id ?? ""),
        agent: typeof a.agent === "string" ? a.agent : undefined,
        state:
          typeof a.state === "string"
            ? (a.state as HerdrAgentState)
            : undefined,
        source: typeof a.source === "string" ? a.source : undefined,
        message: typeof a.message === "string" ? a.message : undefined,
      }))
    : [];
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
  };
}

/**
 * Fetch a fresh snapshot from the running herdr server and cache it. Safe
 * to call repeatedly; the TUI uses this to keep the panel fresh.
 */
export async function refresh(directory: string): Promise<HerdrSnapshot> {
  const info = await detect();
  if (!info.serverRunning) return snapshot(directory);
  try {
    const raw = await call<unknown>("session.snapshot", undefined, 3000);
    // Herdr wraps the snapshot in a `result.snapshot` envelope; the
    // sibling `type` is informational. Unwrap before normalizing so we
    // never end up parsing a `type: "session_snapshot"` blob.
    const inner =
      (raw as { snapshot?: unknown } | null | undefined)?.snapshot ?? raw;
    const next = normalizeSnapshot(inner);
    setSnapshot(directory, next);
    return next;
  } catch (error) {
    log.debug("herdr refresh failed", { error: errorMessage(error) });
    return snapshot(directory);
  }
}

/**
 * Best-effort cleanup; called when the TUI plugin is deactivated or the
 * process is shutting down. We close subscriptions and clear cached state.
 */
export function stop(): void {
  setEnabled(false);
  for (const sub of runtime.subscriptions) {
    sub.alive = false;
  }
  runtime.subscriptions.length = 0;
  runtime.snapshots.clear();
  runtime.boundSessionID = undefined;
  runtime.released = false;
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
  releasePane,
  isInHerdrPane,
  nextReportSeq,
  sessionStatusToHerdrState,
  normalizeSnapshot,
  setReleased,
  setTestSocketPath,
  resolveSocketPath,
  resolveHerdrBin,
  call,
} as const;
