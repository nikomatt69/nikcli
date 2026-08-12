import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade, upgradeNow } from "@/cli/upgrade"
import { GlobalBus } from "@/bus/global"
import { createNikcliClient, type Event } from "@nikcli-ai/sdk/v2"
import { Flag } from "@/flag/flag"
import { Process } from "@/util/process"
import { IslandBridge } from "@/plugin/island/bridge"
import { MobileAuth } from "@/mobile/auth"

Process.ensureMetadata("worker")

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: ReturnType<typeof Server.listen> | undefined
let shuttingDown: Promise<void> | undefined

const eventStreams = new Map<string, AbortController>()

function startEventStream(directory: string) {
  const id = crypto.randomUUID()
  const abort = new AbortController()
  eventStreams.set(id, abort)
  const signal = abort.signal

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth) request.headers.set("Authorization", auth)
    return Server.fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createNikcliClient({
    baseUrl: "http://nikcli.local",
    directory,
    fetch: fetchFn,
    signal,
  })

  ;(async () => {
    while (!signal.aborted) {
      const events = await Promise.resolve(
        sdk.event.subscribe(
          {},
          {
            signal,
          },
        ),
      ).catch(() => undefined)

      if (!events) {
        await Bun.sleep(250)
        continue
      }

      try {
        for await (const event of events.stream) {
          Rpc.emit("event", { id, event: event as Event })
        }
      } catch (error) {
        // A dropped stream must not kill the subscription loop — log and reconnect.
        if (signal.aborted) return
        Log.Default.warn("event stream interrupted, reconnecting", {
          error: error instanceof Error ? error.message : error,
        })
      }

      if (!signal.aborted) {
        await Bun.sleep(250)
      }
    }
  })().catch((error) => {
    if (signal.aborted) return
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })

  return id
}

function stopEventStream(id: string) {
  eventStreams.get(id)?.abort()
  eventStreams.delete(id)
}

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async server(input: {
    port: number
    hostname: string
    mdns?: boolean
    cors?: string[]
    mobileAuthRequired?: boolean
  }) {
    if (shuttingDown) {
      await shuttingDown
      shuttingDown = undefined
    }
    if (server) await server.stop(true)
    server = Server.listen(input)
    return { url: server.url.toString() }
  },
  async mobileToken(input: { name?: string; expiresInDays?: number }) {
    return MobileAuth.create(input)
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch((error) => {
          Log.Default.debug("upgrade check failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      },
    })
  },
  async upgradeNow(input: { directory: string; method: string; version: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgradeNow(input.method as Installation.Method, input.version)
      },
    })
  },
  async reload() {
    await Instance.disposeAll()
  },
  async subscribe(input: { directory: string | undefined }) {
    return startEventStream(input.directory || process.cwd())
  },
  async unsubscribe(input: { id: string }) {
    stopEventStream(input.id)
  },
  async shutdown() {
    const shutdown = (shuttingDown ??= (async () => {
      Log.Default.info("worker shutting down")
      for (const id of [...eventStreams.keys()]) {
        stopEventStream(id)
      }
      await Instance.disposeAll()
      if (server) {
        const current = server
        server = undefined
        current.stop(true)
      }
      // Explicit, not process.on("exit", ...): this worker's own `process` is
      // shared with the parent thread, so an "exit" listener here would fire
      // on the wrong signal (see IslandBridge.stop()'s doc for how this was
      // found). This IS the real, deterministic end of this worker's life.
      IslandBridge.stop()
    })())
    await shutdown
    if (shuttingDown === shutdown) shuttingDown = undefined
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.NIKCLI_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.NIKCLI_SERVER_USERNAME ?? "nikcli"
  return `Basic ${btoa(`${username}:${password}`)}`
}
