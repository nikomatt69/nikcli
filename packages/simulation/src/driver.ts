export interface Notification<T = unknown> {
  readonly method: string
  readonly params: T
}

export interface DriverSocket {
  readonly call: <T = unknown>(method: string, params?: unknown) => Promise<T>
  readonly next: <T = unknown>(method: string, timeoutMs?: number) => Promise<T>
  readonly close: () => void
}

type Pending = { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }

function timeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: Timer | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs)
    }),
  ]).finally(() => timer && clearTimeout(timer))
}

async function open(url: string, timeoutMs: number) {
  const socket = new WebSocket(url)
  await timeout(
    new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => reject(new Error(`Unable to connect to ${url}`)), { once: true })
    }),
    timeoutMs,
    url,
  )
  return socket
}

/** Connect to a simulation JSON-RPC WebSocket, retrying while the CLI boots. */
export async function connect(url: string, options: { readonly timeoutMs?: number; readonly retryMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000
  const retryMs = options.retryMs ?? 50
  const deadline = Date.now() + timeoutMs
  let socket: WebSocket | undefined
  let lastError: unknown
  while (!socket && Date.now() < deadline) {
    try {
      socket = await open(url, Math.min(1_000, Math.max(1, deadline - Date.now())))
    } catch (error) {
      lastError = error
      await Bun.sleep(retryMs)
    }
  }
  if (!socket) throw new Error(`Unable to connect to ${url}`, { cause: lastError })

  let id = 0
  const pending = new Map<number, Pending>()
  const notifications = new Map<string, unknown[]>()
  const waiters = new Map<string, Array<(value: unknown) => void>>()

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    if (typeof message.id === "number") {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message ?? "Simulation RPC error"))
      else request.resolve(message.result)
      return
    }
    if (typeof message.method !== "string") return
    const waiter = waiters.get(message.method)?.shift()
    if (waiter) waiter(message.params)
    else notifications.set(message.method, [...(notifications.get(message.method) ?? []), message.params])
  })

  socket.addEventListener("close", () => {
    for (const request of pending.values()) request.reject(new Error(`Simulation socket closed: ${url}`))
    pending.clear()
  })

  return {
    call<T = unknown>(method: string, params?: unknown) {
      const requestID = ++id
      const result = new Promise<T>((resolve, reject) => {
        pending.set(requestID, { resolve: resolve as (value: unknown) => void, reject })
      })
      socket.send(
        JSON.stringify({ jsonrpc: "2.0", id: requestID, method, ...(params === undefined ? {} : { params }) }),
      )
      return timeout(result, timeoutMs, `${method} response`).finally(() => pending.delete(requestID))
    },
    next<T = unknown>(method: string, waitMs = timeoutMs) {
      const queued = notifications.get(method)?.shift()
      if (queued !== undefined) return Promise.resolve(queued as T)
      return timeout(
        new Promise<T>((resolve) => {
          waiters.set(method, [...(waiters.get(method) ?? []), resolve as (value: unknown) => void])
        }),
        waitMs,
        method,
      )
    },
    close() {
      socket.close()
    },
  } satisfies DriverSocket
}

export * as SimulationDriver from "./driver"
