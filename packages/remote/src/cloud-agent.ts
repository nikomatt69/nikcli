import { EventEmitter } from "node:events"
import WebSocket from "ws"

export interface CloudAgentConfig {
  cloudUrl: string
  token: string
  deviceID: string
  fetchImpl?: typeof fetch
}

export interface CloudDeviceRegistration {
  name: string
  platform: "ios" | "android" | "web" | "desktop"
  publicKey: string
  pushToken?: string
}

export interface CloudSyncOperation {
  sessionID: string
  entityType: "session" | "message"
  operation: "upsert" | "delete"
  entityID: string
  payload?: string
  hash: string
  timestamp: number
}

type RelayEnvelope = {
  type: string
  payload?: unknown
  timestamp: number
}

export class CloudAgent extends EventEmitter {
  private readonly config: CloudAgentConfig
  private readonly fetchImpl: typeof fetch
  private socket: WebSocket | null = null
  private connectedSessionID: string | null = null

  constructor(config: CloudAgentConfig) {
    super()
    if (!config.cloudUrl) throw new Error("cloudUrl is required")
    if (!config.token) throw new Error("token is required")
    if (!config.deviceID) throw new Error("deviceID is required")
    this.config = config
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  private get authHeaders() {
    return {
      Authorization: `Bearer ${this.config.token}`,
      "Content-Type": "application/json",
    }
  }

  private buildURL(pathname: string): URL {
    return new URL(pathname, this.config.cloudUrl)
  }

  async registerDevice(input: CloudDeviceRegistration): Promise<void> {
    const response = await this.fetchImpl(this.buildURL("/auth/device/register"), {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        deviceID: this.config.deviceID,
        ...input,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Failed to register device (${response.status}): ${body}`)
    }
  }

  async connectRelay(sessionID: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.connectedSessionID === sessionID) return
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      await this.disconnectRelay()
    }

    const relay = this.buildURL(`/relay/${encodeURIComponent(sessionID)}`)
    relay.protocol = relay.protocol === "https:" ? "wss:" : "ws:"
    relay.searchParams.set("token", this.config.token)
    relay.searchParams.set("deviceID", this.config.deviceID)

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(relay.toString())
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        ws.terminate()
        reject(new Error("Relay connection timeout"))
      }, 15000)

      const settle = (callback: (value?: unknown) => void, value?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        callback(value)
      }

      ws.once("open", () => {
        this.socket = ws
        this.connectedSessionID = sessionID
        this.emit("connected", { sessionID })
        settle(() => resolve())
      })

      ws.once("error", (error) => {
        settle(reject, error)
      })

      ws.on("close", (code, reason) => {
        if (!settled) {
          settle(reject, new Error(`Relay closed before connect (${code}): ${reason.toString() || "unknown reason"}`))
        }
        this.socket = null
        this.connectedSessionID = null
        this.emit("disconnected", {
          code,
          reason: reason.toString(),
        })
      })

      ws.on("message", (raw) => {
        const text = raw.toString()
        let message: RelayEnvelope
        try {
          message = JSON.parse(text) as RelayEnvelope
        } catch {
          this.emit("error", new Error(`Invalid relay payload: ${text.slice(0, 200)}`))
          return
        }

        if (message.type === "relay.presence") {
          this.emit("presence", message.payload)
          return
        }

        if (message.type === "relay.message") {
          this.emit("message", message.payload)
          return
        }

        if (message.type === "relay.error") {
          this.emit("error", new Error(`Relay error: ${JSON.stringify(message.payload)}`))
          return
        }

        this.emit("event", message)
      })
    })
  }

  async disconnectRelay(): Promise<void> {
    if (!this.socket) return

    const ws = this.socket
    this.socket = null
    this.connectedSessionID = null

    if (ws.readyState === WebSocket.CLOSED) return
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate()
      return
    }

    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve()
      }

      const timeout = setTimeout(() => done(), 3000)
      ws.once("close", () => done())
      ws.once("error", () => done())
      ws.close(1000, "client_close")
    })
  }

  sendRelayMessage(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay socket is not connected")
    }

    this.socket.send(JSON.stringify(payload))
  }

  isRelayConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  currentSessionID(): string | null {
    return this.connectedSessionID
  }

  async pushSync(operations: CloudSyncOperation[]): Promise<{ applied: number; cursor: number }> {
    const response = await this.fetchImpl(this.buildURL("/sync/push"), {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        deviceID: this.config.deviceID,
        operations,
      }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      applied?: number
      cursor?: number
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(data.error?.message || `Sync push failed (${response.status})`)
    }

    return {
      applied: data.applied ?? 0,
      cursor: data.cursor ?? Date.now(),
    }
  }

  async pullSync(since: number, limit = 200): Promise<{ operations: unknown[]; cursor: number }> {
    const response = await this.fetchImpl(this.buildURL("/sync/pull"), {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({ since, limit }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      operations?: unknown[]
      cursor?: number
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(data.error?.message || `Sync pull failed (${response.status})`)
    }

    return {
      operations: data.operations ?? [],
      cursor: data.cursor ?? since,
    }
  }
}
