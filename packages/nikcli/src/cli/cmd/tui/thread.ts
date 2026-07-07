import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions, shouldStartHttpServer } from "@/cli/network"
import { createNikcliClient, type Event } from "@nikcli-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { errorMessage } from "@/util/error"
import { Process } from "@/util/process"
import { SessionPrimitives } from "@/session/primitives"

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

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (directory, handler) => {
      const id = await client.call("subscribe", { directory })
      const unsub = client.on<{ id: string; event: Event }>("event", (e) => {
        if (e.id === id) handler(e.event)
      })
      return () => {
        unsub()
        void client.call("unsubscribe", { id })
      }
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

    const worker = new Worker(workerPath, {
      env: createWorkerEnv(),
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
      await withTimeout(client.call("shutdown", undefined), WORKER_SHUTDOWN_TIMEOUT_MS).catch((error) => {
        Log.Default.warn("worker shutdown failed", {
          error: errorMessage(error),
        })
      })
      worker.terminate()
    }

    const restart = async () => {
      await stop()
      process.exitCode = 0
      // Re-exec the current process with the same arguments
      Bun.spawn([process.execPath, ...process.argv.slice(1)], {
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

      const { tui } = await import("./app")
      const tuiPromise = tui({
        url,
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
        upgradeNow: async (method: string, version: string) => {
          await client.call("upgradeNow", { directory: cwd, method, version })
        },
        startServer: !shouldStartServer
          ? async () => {
              const result = await client.call("server", {
                port: 0,
                hostname: "127.0.0.1",
              })
              return result.url
            }
          : undefined,
      })

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch((error) => {
          // Surface the failure in the log so it's not silently lost — it is
          // *expected* for offline / firewalled users but still useful info.
          Log.Default.warn("upgrade check failed", {
            error: errorMessage(error),
          })
        })
      }, 1000)

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
