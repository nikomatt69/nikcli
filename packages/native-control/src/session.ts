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

export class NativeSession {
  private readonly createdAt = Date.now()
  private readonly controller = new AbortController()
  private readonly eventLog: SurfaceEvent[] = []
  private status: SessionStatus = "running"

  constructor(
    readonly name: string,
    readonly url: string,
  ) {
    void this.consumeEvents()
  }

  info(surfaceCount = 0): SessionInfo {
    return {
      name: this.name,
      url: this.url,
      status: this.status,
      createdAt: this.createdAt,
      surfaces: surfaceCount,
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
    return this.request("/native-ui/surfaces", "POST", SurfaceSchema.parse(surface), SurfaceSchema)
  }

  async update(surface: Surface): Promise<Surface> {
    return this.request(
      `/native-ui/surfaces/${encodeURIComponent(surface.id)}`,
      "PUT",
      SurfaceSchema.parse(surface),
      SurfaceSchema,
    )
  }

  async close(surfaceID: string): Promise<void> {
    this.assertRunning()
    const response = await fetch(this.endpoint(`/native-ui/surfaces/${encodeURIComponent(surfaceID)}`), {
      method: "DELETE",
      signal: this.controller.signal,
    })
    if (!response.ok) throw new Error(`Native UI close failed: ${response.status}`)
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

  async wait(condition: WaitCondition): Promise<SurfaceEvent> {
    const existing = this.eventLog.find((event) => matches(event, condition))
    if (existing) return existing
    const timeout = condition.timeout ?? 120_000
    return new Promise((resolve, reject) => {
      const startedAt = this.eventLog.length
      const timer = setInterval(() => {
        const event = this.eventLog.slice(startedAt).find((candidate) => matches(candidate, condition))
        if (!event) return
        cleanup()
        resolve(event)
      }, 25)
      const deadline = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for native UI event after ${timeout}ms`))
      }, timeout)
      const cleanup = () => {
        clearInterval(timer)
        clearTimeout(deadline)
      }
    })
  }

  stop(): void {
    if (this.status === "closed") return
    this.status = "closed"
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
            if (parsed.success) {
              this.eventLog.push(parsed.data)
              if (this.eventLog.length > 500) this.eventLog.shift()
            }
          }
        }
      } catch {
        if (this.controller.signal.aborted) return
        await Bun.sleep(250)
      }
    }
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
    for (let index = this.eventLog.length - 1; index >= 0; index--) {
      const event = this.eventLog[index]
      if (!event) continue
      const id =
        event.type === "surface-opened" || event.type === "surface-updated" ? event.surface.id : event.surfaceId
      if (id === surfaceID) this.eventLog.splice(index, 1)
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
