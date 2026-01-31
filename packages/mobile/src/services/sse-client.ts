import type { ConnectionStatus, SSEConfig, SSEEvent } from "../types"

type EventListener = (event: SSEEvent) => void
type StatusListener = (status: ConnectionStatus) => void
type ErrorListener = (error: Error) => void

interface ParsedEvent {
  id?: string
  event?: string
  data: string
  retry?: number
}

interface SSEClientState {
  status: ConnectionStatus
  url: string | null
  secret: string | null
  lastEventAt: number | null
  reconnectAttempt: number
}

export class SSEClient {
  private config: SSEConfig | null = null
  private abortController: AbortController | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private eventListeners: Set<EventListener> = new Set()
  private statusListeners: Set<StatusListener> = new Set()
  private errorListeners: Set<ErrorListener> = new Set()
  private heartbeatInterval: NodeJS.Timeout | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private isManuallyClosed = false
  private decoder = new TextDecoder()
  private buffer = ""
  private lastEventId: string | undefined = undefined

  private state: SSEClientState = {
    status: "idle",
    url: null,
    secret: null,
    lastEventAt: null,
    reconnectAttempt: 0,
  }

  getStatus(): ConnectionStatus {
    return this.state.status
  }

  getLastEventAt(): number | null {
    return this.state.lastEventAt
  }

  getReconnectAttempt(): number {
    return this.state.reconnectAttempt
  }

  on(event: "event", listener: EventListener): () => void
  on(event: "status", listener: StatusListener): () => void
  on(event: "error", listener: ErrorListener): () => void
  on(event: string, listener: (...args: unknown[]) => void): () => void {
    switch (event) {
      case "event":
        this.eventListeners.add(listener as EventListener)
        break
      case "status":
        this.statusListeners.add(listener as StatusListener)
        break
      case "error":
        this.errorListeners.add(listener as ErrorListener)
        break
    }
    return () => this.off(event, listener)
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    switch (event) {
      case "event":
        this.eventListeners.delete(listener as EventListener)
        break
      case "status":
        this.statusListeners.delete(listener as StatusListener)
        break
      case "error":
        this.errorListeners.delete(listener as ErrorListener)
        break
    }
  }

  async connect(config: SSEConfig): Promise<void> {
    if (this.state.status === "connected" || this.state.status === "connecting") {
      await this.disconnect()
    }

    this.config = config
    this.isManuallyClosed = false
    this.state.reconnectAttempt = 0

    await this.doConnect(config.url, config.secret)
  }

  private async doConnect(url: string, secret: string, attempt = 0): Promise<void> {
    this.updateStatus("connecting")

    const eventUrl = new URL(url)
    eventUrl.pathname = "/event"
    if (secret) {
      eventUrl.searchParams.set("token", secret)
    }

    try {
      this.abortController = new AbortController()
      const timeoutMs = 30000
      const timeoutId = setTimeout(() => this.abortController?.abort(), timeoutMs)

      const response = await fetch(eventUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Connection: "keep-alive",
        },
        signal: this.abortController.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error("Response body is null")
      }

      this.reader = response.body.getReader()
      this.state.url = url
      this.state.secret = secret
      this.updateStatus("connected")
      this.state.reconnectAttempt = 0
      this.startHeartbeat()

      await this.readStream()
    } catch (error) {
      clearTimeout(this.reconnectTimeout ?? undefined)
      this.stopHeartbeat()

      const err = error instanceof Error ? error : new Error(String(error))

      if (this.isManuallyClosed) {
        this.updateStatus("closed")
        return
      }

      this.emitError(err)
      await this.scheduleReconnect(url, secret, attempt + 1)
    }
  }

  private async readStream(): Promise<void> {
    if (!this.reader) return

    try {
      while (true) {
        const { done, value } = await this.reader.read()

        if (done) {
          this.handleStreamEnd()
          return
        }

        const chunk = this.decoder.decode(value, { stream: true })
        this.buffer += chunk
        this.processBuffer()
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.emitError(err)
      await this.handleConnectionError()
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (line.startsWith(":")) {
        continue
      }

      const colonIndex = line.indexOf(":")
      const field = colonIndex >= 0 ? line.slice(0, colonIndex) : line
      const value = colonIndex >= 0 ? line.slice(colonIndex + 1).trimStart() : ""

      if (field === "event" || field === "data" || field === "id" || field === "retry") {
        const event = this.parseField(field, value)
        if (event) {
          this.emitEvent(event)
        }
      }
    }
  }

  private parseField(field: string, value: string): ParsedEvent | null {
    if (field === "id") {
      this.lastEventId = value || undefined
      return null
    }

    if (field === "retry") {
      return null
    }

    const eventType = field === "event" ? value || "message" : "message"

    if (field === "data") {
      return {
        id: this.lastEventId,
        event: eventType,
        data: value,
      }
    }

    return null
  }

  private emitEvent(parsed: ParsedEvent): void {
    try {
      const data = JSON.parse(parsed.data)

      const event: SSEEvent = {
        id: parsed.id,
        event: parsed.event,
        data,
        timestamp: Date.now(),
      }

      this.state.lastEventAt = event.timestamp
      this.config?.onEvent?.(event)

      for (const listener of this.eventListeners) {
        listener(event)
      }

      if (parsed.event === "server.heartbeat") {
        this.state.lastEventAt = Date.now()
      }
    } catch {
      const event: SSEEvent = {
        id: parsed.id,
        event: parsed.event,
        data: parsed.data,
        timestamp: Date.now(),
      }

      this.state.lastEventAt = event.timestamp
      this.config?.onEvent?.(event)

      for (const listener of this.eventListeners) {
        listener(event)
      }
    }
  }

  private emitError(error: Error): void {
    this.config?.onError?.(error)

    for (const listener of this.errorListeners) {
      listener(error)
    }
  }

  private updateStatus(status: ConnectionStatus): void {
    this.state.status = status
    this.config?.onStatusChange?.(status)

    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  private startHeartbeat(): void {
    const interval = this.config?.heartbeatInterval ?? 35000

    this.heartbeatInterval = setInterval(() => {
      const timeSinceLastEvent = this.state.lastEventAt ? Date.now() - this.state.lastEventAt : Infinity

      if (timeSinceLastEvent > interval * 2) {
        this.handleHeartbeatTimeout()
      }
    }, interval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private handleHeartbeatTimeout(): void {
    this.stopHeartbeat()
    this.emitError(new Error("Heartbeat timeout - no events received"))
    this.handleConnectionError()
  }

  private handleStreamEnd(): void {
    this.stopHeartbeat()
    this.updateStatus("error")
    this.handleConnectionError()
  }

  private async handleConnectionError(): Promise<void> {
    if (this.isManuallyClosed) {
      this.updateStatus("closed")
      return
    }

    await this.scheduleReconnect(this.state.url ?? "", this.state.secret ?? "", this.state.reconnectAttempt + 1)
  }

  private async scheduleReconnect(url: string, secret: string, attempt: number): Promise<void> {
    this.updateStatus("reconnecting")
    this.state.reconnectAttempt = attempt

    const maxRetries = this.config?.maxRetries ?? Infinity
    if (attempt > maxRetries) {
      this.updateStatus("error")
      return
    }

    const baseDelay = this.config?.retryDelay ?? 3000
    const maxDelay = this.config?.maxRetryDelay ?? 30000
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)

    const jitter = Math.random() * 1000
    const actualDelay = delay + jitter

    this.reconnectTimeout = setTimeout(async () => {
      await this.doConnect(url, secret, attempt)
    }, actualDelay)
  }

  async disconnect(): Promise<void> {
    this.isManuallyClosed = true
    this.stopHeartbeat()

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.reader) {
      try {
        await this.reader.cancel()
      } catch {}
      this.reader = null
    }

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    this.updateStatus("closed")
    this.state.url = null
    this.state.secret = null
  }

  isActive(): boolean {
    return this.state.status === "connected" || this.state.status === "reconnecting"
  }
}

export const sseClient = new SSEClient()
