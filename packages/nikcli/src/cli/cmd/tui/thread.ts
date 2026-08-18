import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@tui/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { UI } from "@/cli/ui"
import { localPluginHost } from "./plugin/host-local"
import { TuiConfig } from "@/config/tui"
import { iife } from "@nikcli-ai/util/iife"
import { Log } from "@nikcli-ai/util/log"
import { withNetworkOptions, resolveNetworkOptions, shouldStartHttpServer } from "@/cli/network"
import { createNikcliClient, type Event } from "@nikcli-ai/sdk/httpapi"
import type { EventSource } from "@nikcli-ai/tui/context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "@nikcli-ai/util/win32"
import { errorMessage } from "@nikcli-ai/util/error-format"
import { HerdrBridge } from "@nikcli-ai/util/herdr-bridge"
import { Process } from "@nikcli-ai/util/process"
import { SessionPrimitives } from "@nikcli-ai/util/session-primitives"

declare global {
  const NIKCLI_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

const WORKER_SHUTDOWN_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: Timer | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
      timeout.unref?.()
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

export function createEventSource(client: RpcClient): EventSource {
  // The worker forwards every GlobalBus event over the "global.event" RPC
  // channel with its {directory, payload} envelope intact, so the TUI sees
  // events from every instance (root + worktree workspaces) — same contract
  // as the HTTP /global/event stream.
  return {
    subscribe: async (_directory, handler) => {
      const unsub = client.on<{ directory?: string; payload: Event }>("global.event", (envelope) => {
        if (!envelope?.payload?.type) return
        handler(envelope)
      })
      return unsub
    },
  }
}

export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  const root = path.resolve(envPWD ?? cwd)
  if (!project) return path.resolve(cwd)
  return path.resolve(path.isAbsolute(project) ? project : path.join(root, project))
}

export function createWorkerEnv(overrides: Record<string, string> = {}) {
  return Process.sanitizedEnv({
    [Process.ROLE_ENV]: "worker",
    [Process.RUN_ID_ENV]: Process.ensureRunID(),
    ...overrides,
  })
}

export function shouldTerminateWorker(platform = process.platform): boolean {
  return platform !== "win32"
}

export function releaseWorkerWithoutTermination(worker: object): void {
  ;(worker as { unref?: () => void }).unref?.()
}

export async function shutdownWorker(input: {
  shutdown: () => Promise<unknown>
  terminate: () => void
  release: () => void
  platform?: typeof process.platform
  timeoutMs?: number
}) {
  const terminate = shouldTerminateWorker(input.platform)
  if (!terminate) {
    input.release()
    void withTimeout(input.shutdown(), input.timeoutMs ?? WORKER_SHUTDOWN_TIMEOUT_MS).catch(() => undefined)
    return
  }
  try {
    await withTimeout(input.shutdown(), input.timeoutMs ?? WORKER_SHUTDOWN_TIMEOUT_MS)
  } finally {
    input.terminate()
  }
}

/** Attempt chdir for TUI thread bootstrap; false when the path is invalid. */
export function chdirToThreadDirectory(cwd: string): boolean {
  try {
    process.chdir(cwd)
    return true
  } catch {
    return false
  }
}

/** Change process cwd or exit 1 with a user-facing error (TUI thread entry). */
export function changeDirectoryOrExit(cwd: string): void {
  if (!chdirToThreadDirectory(cwd)) {
    UI.error("Failed to change directory to " + cwd)
    process.exit(1)
  }
}

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
}) {
  if (!input.sessionID) return

  const parsed = SessionPrimitives.ID.safeParse(input.sessionID)
  if (!parsed.success) {
    throw new Error(`Invalid session ID: ${input.sessionID}`)
  }

  await createNikcliClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
  }).session.get({ sessionID: parsed.data }, { throwOnError: true })
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start nikcli tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start nikcli in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    // Resolve relative paths against PWD to preserve behavior when using --cwd flag.
    const cwd = resolveThreadDirectory(args.project)
    // Three layouts, in the order they are tried below: a compiled binary (the
    // `NIKCLI_WORKER_PATH` define, resolved against the bunfs root), a published dist where this
    // command is inlined into the root entry, and a dev checkout where it is a sibling file.
    const localWorker = new URL("./worker.ts", import.meta.url)
    const distWorker = new URL("./cli/cmd/tui/worker.js", import.meta.url)
    const workerPath = await iife(async () => {
      if (typeof NIKCLI_WORKER_PATH !== "undefined") return NIKCLI_WORKER_PATH
      if (await Bun.file(distWorker).exists()) return distWorker
      return localWorker
    })
    try {
      process.chdir(cwd)
    } catch {
      UI.error("Failed to change directory to " + cwd)
      process.exit(1)
    }

    // Drive mode: the deterministic OpenAI mock and the driver control
    // websocket run in this (TUI) process; the worker is routed to them via
    // NIKCLI_CONFIG_CONTENT so its default model resolves against the mock.
    const simulation = await iife(async () => {
      if (!process.env.NIKCLI_DRIVE) return undefined
      // Resolve the @napi-rs/canvas CJS binding before `./app` loads
      // TuiPluginRuntime: OpenTUI's runtime Bun plugin registers a catch-all
      // async onLoad, after which require() of a not-yet-cached CJS dep
      // fails. Only the binding is preloaded (dependency-free module) — the
      // frontend graph itself must load *after* the plugin so the harness
      // and the app share one rewritten module graph.
      const canvas = await import("@nikcli-ai/simulation/frontend/canvas")
      canvas.preload()
      const { SimulationBackend, simulationWorkerEnv } = await import("@nikcli-ai/simulation/backend")
      const backend = await SimulationBackend.start()
      return { backend, env: simulationWorkerEnv(backend.openai) }
    })

    const worker = new Worker(workerPath, {
      env: createWorkerEnv(simulation?.env),
    })
    worker.onerror = (e) => {
      Log.Default.error("worker error", {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error ? errorMessage(e.error) : undefined,
      })
    }
    const client = Rpc.client<typeof rpc>(worker)
    const error = (e: unknown) => {
      Log.Default.error("process error", { error: errorMessage(e) })
    }
    const reload = () => {
      client.call("reload", undefined).catch((error) => {
        Log.Default.warn("worker reload failed", {
          error: errorMessage(error),
        })
      })
    }
    process.on("uncaughtException", error)
    process.on("unhandledRejection", error)
    process.on("SIGUSR2", reload)

    let stopped = false
    const stop = async () => {
      if (stopped) return
      stopped = true
      process.off("uncaughtException", error)
      process.off("unhandledRejection", error)
      process.off("SIGUSR2", reload)
      // Bound shutdown on every platform. Windows releases the worker without
      // terminating it so MCP subprocess teardown cannot detach the console.
      await shutdownWorker({
        shutdown: () => client.call("shutdown", undefined),
        terminate: () => worker.terminate(),
        release: () => releaseWorkerWithoutTermination(worker),
      }).catch((error) => {
        Log.Default.warn("worker shutdown failed", {
          error: errorMessage(error),
        })
      })
      // The worker owns the herdr plugin, but on Windows its shutdown is
      // fire-and-forget (see shutdownWorker), so the plugin's dispose is cut
      // off before it can hand the pane back. This is the process that is
      // actually about to exit, so release from here. Synchronous and
      // idempotent; a no-op outside a herdr pane.
      HerdrBridge.releasePaneSync()
      simulation?.backend.stop()
    }

    const restart = async () => {
      await stop()
      process.exitCode = 0
      // Re-exec the current process with the same arguments
      Bun.spawn([process.execPath, ...process.argv.slice(1)], {
        windowsHide: true,
        stdio: ["inherit", "inherit", "inherit"],
        env: process.env,
        detached: true,
      })
      process.exit(0)
    }

    // Mobile (and any nikcli-managed PTY) sets NIKCLI_TERMINAL=1 in env. Bun can still report
    // `stdin.isTTY === false` in that PTY, which would incorrectly take the "piped stdin" path
    // below and block forever on `Bun.stdin.text()` — so the OpenTUI renderer never starts.
    const stdinProbablyInteractive = process.stdin.isTTY || process.env.NIKCLI_TERMINAL === "1"

    const prompt = await iife(async () => {
      const piped = stdinProbablyInteractive ? undefined : await Bun.stdin.text()
      if (!args.prompt) return piped
      return piped ? piped + "\n" + args.prompt : args.prompt
    })

    const networkOpts = await resolveNetworkOptions(args as Parameters<typeof resolveNetworkOptions>[0])
    const shouldStartServer = shouldStartHttpServer(networkOpts)

    let url: string
    let customFetch: typeof fetch | undefined
    let events: EventSource | undefined

    if (shouldStartServer) {
      // Start HTTP server for external access
      const server = await client.call("server", networkOpts)
      url = server.url
    } else {
      // Use direct RPC communication (no HTTP)
      url = "http://nikcli.local"
      customFetch = createWorkerFetch(client)
      events = createEventSource(client)
    }

    try {
      await validateSession({
        url,
        sessionID: args.session,
        directory: cwd,
        fetch: customFetch,
      })
    } catch (error) {
      UI.error(errorMessage(error))
      process.exitCode = 1
      await stop()
      return
    }

    const unguard = win32InstallCtrlCGuard()
    try {
      win32DisableProcessedInput()

      const { tui } = await import("@nikcli-ai/tui/app")
      // Read here, not in the terminal: it feeds the renderer config, so it is
      // needed before any transport exists. See `tui()`'s `tuiConfig` prop.
      const tuiConfig = await TuiConfig.get().catch(() => undefined)

      const tuiPromise = tui({
        url,
        pluginHost: localPluginHost,
        tuiConfig,
        directory: cwd,
        fetch: customFetch,
        events,
        args: {
          continue: args.continue,
          sessionID: args.session,
          agent: args.agent,
          model: args.model,
          prompt,
        },
        onExit: stop,
        onRestart: restart,
        checkUpgrade: async () => {
          await client.call("checkUpgrade", { directory: cwd }).catch((error) => {
            Log.Default.warn("upgrade check failed", {
              error: errorMessage(error),
            })
          })
        },
        upgradeNow: async (method: string, version: string) => {
          // Re-throw worker errors so the TUI toast in app.tsx can show the
          // real reason. Without this, a failed upgrade silently disappears:
          // the toast "Updating to v..." shows for 30s and the user is left
          // with the old version and no explanation. The RPC layer preserves
          // UpgradeFailedError.stderr across the worker hop (see
          // test/tui/rpc-error.test.ts), so the toast only needs the error
          // to actually reach it.
          await client.call("upgradeNow", { directory: cwd, method, version }).catch((error) => {
            Log.Default.error("upgrade failed", {
              error: errorMessage(error),
            })
            throw error
          })
        },
        startServer: !shouldStartServer
          ? async (options = {}) => {
              const result = await client.call("server", {
                port: options.port ?? 0,
                hostname: options.hostname ?? "127.0.0.1",
                mdns: options.mdns,
                mobileAuthRequired: options.mobileAuthRequired,
              })
              return result.url
            }
          : undefined,
        createMobileToken: !shouldStartServer
          ? async (options = {}) =>
              client.call("mobileToken", {
                name: options.name,
                expiresInDays: options.expiresInDays,
              })
          : undefined,
      })

      try {
        await tuiPromise
      } finally {
        await stop()
      }
    } finally {
      unguard?.()
    }
  },
})
