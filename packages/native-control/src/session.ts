import { SurfaceEventSchema, SurfaceSchema, type Surface, type SurfaceEvent } from "@nikcli-ai/native-ui-protocol"

export type SessionStatus = "running" | "closed"

export interface SessionInfo {
  readonly name: string
  readonly url: string
  readonly status: SessionStatus
  readonly createdAt: number
  readonly surfaces: number
  readonly events: number
}

export interface NativeFrame {
  readonly capturedAt: number
  readonly surfaces: Surface[]
  readonly events: SurfaceEvent[]
}

export type WaitCondition = {
  readonly surfaceID?: string
  readonly event?: SurfaceEvent["type"]
  readonly timeout?: number
}

interface Waiter {
  readonly condition: WaitCondition
  resolve(event: SurfaceEvent): void
  abort(): void
}

const MAX_EVENTS = 500

export class NativeSession {
  private readonly createdAt = Date.now()
  private readonly controller = new AbortController()
  private readonly eventLog: SurfaceEvent[] = []
  private readonly pending: SurfaceEvent[] = []
  private readonly openSurfaces = new Set<string>()
  private readonly waiters = new Set<Waiter>()
  private status: SessionStatus = "running"

  constructor(
    readonly name: string,
    readonly url: string,
  ) {
    void this.consumeEvents()
  }

  info(): SessionInfo {
    return {
      name: this.name,
      url: this.url,
      status: this.status,
      createdAt: this.createdAt,
      surfaces: this.openSurfaces.size,
      events: this.eventLog.length,
    }
  }

  async list(): Promise<Surface[]> {
    this.assertRunning()
    const response = await fetch(this.endpoint("/native-ui/surfaces"), {
      signal: this.controller.signal,
    })
    if (!response.ok) throw new Error(`Native UI list failed: ${response.status}`)
    return SurfaceSchema.array().parse(await response.json())
  }

  async open(surface: Surface): Promise<Surface> {
    this.forget(surface.id)
    const opened = await this.request("/native-ui/surfaces", "POST", SurfaceSchema.parse(surface), SurfaceSchema)
    this.openSurfaces.add(opened.id)
    return opened
  }

  async update(surface: Surface): Promise<Surface> {
    const updated = await this.request(
      `/native-ui/surfaces/${encodeURIComponent(surface.id)}`,
      "PUT",
      SurfaceSchema.parse(surface),
      SurfaceSchema,
    )
    this.openSurfaces.add(updated.id)
    return updated
  }

  async close(surfaceID: string): Promise<void> {
    this.assertRunning()
    const response = await fetch(this.endpoint(`/native-ui/surfaces/${encodeURIComponent(surfaceID)}`), {
      method: "DELETE",
      signal: this.controller.signal,
    })
    if (!response.ok) throw new Error(`Native UI close failed: ${response.status}`)
    this.openSurfaces.delete(surfaceID)
  }

  async dispatch(event: SurfaceEvent): Promise<SurfaceEvent> {
    return this.request("/native-ui/events", "POST", SurfaceEventSchema.parse(event), SurfaceEventSchema)
  }

  async snapshot(): Promise<NativeFrame> {
    return {
      capturedAt: Date.now(),
      surfaces: await this.list(),
      events: [...this.eventLog],
    }
  }

  wait(condition: WaitCondition): Promise<SurfaceEvent> {
    this.assertRunning()
    const delivered = this.takePending(condition)
    if (delivered) return Promise.resolve(delivered)
    const timeout = condition.timeout ?? 120_000
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        condition,
        resolve: (event) => {
          cleanup()
          resolve(event)
        },
        abort: () => {
          cleanup()
          reject(new Error(`Native session "${this.name}" closed while waiting for a native UI event`))
        },
      }
      const deadline = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for native UI event after ${timeout}ms`))
      }, timeout)
      const cleanup = () => {
        clearTimeout(deadline)
        this.waiters.delete(waiter)
      }
      this.waiters.add(waiter)
    })
  }

  stop(): void {
    if (this.status === "closed") return
    this.status = "closed"
    for (const waiter of [...this.waiters]) waiter.abort()
    this.openSurfaces.clear()
    this.controller.abort()
  }

  private async consumeEvents(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const response = await fetch(this.endpoint("/native-ui/events"), {
          headers: { Accept: "text/event-stream" },
          signal: this.controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`Native UI event stream failed: ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (!this.controller.signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          const records = buffer.split("\n\n")
          buffer = records.pop() ?? ""
          for (const record of records) {
            const data = record
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n")
            if (!data) continue
            const parsed = SurfaceEventSchema.safeParse(JSON.parse(data))
            if (parsed.success) this.ingest(parsed.data)
          }
        }
      } catch {
        if (this.controller.signal.aborted) return
        await Bun.sleep(250)
      }
    }
  }

  private ingest(event: SurfaceEvent): void {
    this.eventLog.push(event)
    if (this.eventLog.length > MAX_EVENTS) this.eventLog.shift()
    if (event.type === "surface-opened" || event.type === "surface-updated") this.openSurfaces.add(event.surface.id)
    else if (event.type === "surface-closed") this.openSurfaces.delete(event.surfaceId)
    let deliveredTo = 0
    for (const waiter of [...this.waiters]) {
      if (!matches(event, waiter.condition)) continue
      deliveredTo++
      waiter.resolve(event)
    }
    // Undelivered events stay pending so a later wait can pick them up exactly once.
    if (deliveredTo === 0) {
      this.pending.push(event)
      if (this.pending.length > MAX_EVENTS) this.pending.shift()
    }
  }

  private takePending(condition: WaitCondition): SurfaceEvent | undefined {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const event = this.pending[index]
      if (!event || !matches(event, condition)) continue
      this.pending.splice(index, 1)
      return event
    }
    return undefined
  }

  private async request<T>(
    path: string,
    method: string,
    body: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    this.assertRunning()
    const response = await fetch(this.endpoint(path), {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: this.controller.signal,
    })
    if (!response.ok) throw new Error(`Native UI ${method} ${path} failed: ${response.status}`)
    return schema.parse(await response.json())
  }

  private endpoint(path: string): string {
    return new URL(path, this.url.endsWith("/") ? this.url : `${this.url}/`).toString()
  }

  private assertRunning(): void {
    if (this.status !== "running") throw new Error(`Native session "${this.name}" is closed`)
  }

  private forget(surfaceID: string): void {
    for (const log of [this.eventLog, this.pending]) {
      for (let index = log.length - 1; index >= 0; index--) {
        const event = log[index]
        if (!event) continue
        const id =
          event.type === "surface-opened" || event.type === "surface-updated" ? event.surface.id : event.surfaceId
        if (id === surfaceID) log.splice(index, 1)
      }
    }
  }
}

function matches(event: SurfaceEvent, condition: WaitCondition): boolean {
  if (condition.event && event.type !== condition.event) return false
  if (!condition.surfaceID) return true
  if (event.type === "surface-opened" || event.type === "surface-updated")
    return event.surface.id === condition.surfaceID
  return event.surfaceId === condition.surfaceID
}
