type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason?: unknown) => void
}

export class CdpClient {
  private ws: WebSocket
  private nextId = 0
  private pending = new Map<number, PendingRequest>()
  private listeners = new Map<string, Set<(params: any) => void>>()
  private closeListeners = new Set<(event: CloseEvent) => void>()

  static async connect(url: string) {
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true })
      ws.addEventListener("error", (event) => reject(event), { once: true })
    })
    return new CdpClient(ws)
  }

  private constructor(ws: WebSocket) {
    this.ws = ws
    this.ws.addEventListener("message", (event) => this.handleMessage(String(event.data)))
    this.ws.addEventListener("close", (event) => {
      for (const listener of this.closeListeners) listener(event)
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP connection closed"))
      }
      this.pending.clear()
    })
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw)
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "CDP request failed"))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (!message.method) return
    const listeners = this.listeners.get(message.method)
    if (!listeners) return
    for (const listener of listeners) listener(message.params)
  }

  send<T = any>(method: string, params?: unknown): Promise<T> {
    const id = ++this.nextId
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  on(method: string, listener: (params: any) => void) {
    const listeners = this.listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  onClose(listener: (event: CloseEvent) => void) {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close() {
    this.ws.close()
  }
}
