import { EventEmitter } from "node:events"
import type {
  BroadcastMessage,
  DeviceInfo,
  RemoteNotification,
  RemoteServiceConfig,
  RemoteSession,
  SessionOptions,
  SessionStatus,
} from "./types"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "session-manager" })

type RemoteServer = import("@nikcli-ai/remote").RemoteServer
type NativeSession = import("@nikcli-ai/remote").RemoteSession
type CloudAgent = import("@nikcli-ai/remote/cloud-agent").CloudAgent

interface RelayTerminalMessage {
  from?: {
    userID?: string
    deviceID?: string
  }
  sessionID?: string
  body?: {
    type?: string
    payload?: {
      data?: string
      cols?: number
      rows?: number
    }
  }
}

export class SessionManager extends EventEmitter {
  private server: RemoteServer | null = null
  private cloudAgent: CloudAgent | null = null
  private session: RemoteSession | null = null
  private config: RemoteServiceConfig
  private stopEmitted = false

  constructor(config: RemoteServiceConfig) {
    super()
    this.config = config
    log.debug("SessionManager created", { config })
  }

  async start(options?: SessionOptions): Promise<RemoteSession> {
    const { RemoteServer } = await import("@nikcli-ai/remote")
    this.stopEmitted = false

    log.debug("Starting session", { options })

    this.server = new RemoteServer({
      port: 0,
      enableTunnel: true,
      tunnelProvider: "localtunnel",
      maxConnections: options?.maxDevices ?? this.config.maxDevices,
      sessionTimeout: this.config.sessionExpiry * 1000,
      enableTerminal: true,
    })

    this.server.on("client:connected", (device: DeviceInfo) => {
      if (!this.session) return
      this.session.connectedDevices.push(device)
      this.session.status = "connected"
      this.session.lastActivity = new Date()
      log.info("Client connected", { deviceId: device.id, sessionId: this.session.id })
      this.emit("status:change", this.session)
      this.emit("device:connected", this.session, device)
    })

    this.server.on("client:disconnected", (device: DeviceInfo) => {
      if (!this.session) return
      this.session.connectedDevices = this.session.connectedDevices.filter((d) => d.id !== device.id)
      if (this.session.connectedDevices.length === 0) {
        this.session.status = "waiting"
      }
      log.info("Client disconnected", { deviceId: device.id, sessionId: this.session.id })
      this.emit("status:change", this.session)
      this.emit("device:disconnected", this.session, device)
    })

    this.server.on("tunnel:connected", (url: string) => {
      if (this.session) {
        this.session.qrUrl = url
        log.info("Tunnel connected", { url, sessionId: this.session.id })
        this.emit("tunnel:connected", url)
      }
    })

    this.server.on("tunnel:error", (error: Error) => {
      log.error("Tunnel error", { error: error.message })
      this.emit("tunnel:error", error)
    })

    this.server.on("error", (error: Error) => {
      log.error("Server error", { error: error.message })
      this.emit("error", error)
    })

    this.server.on("stopped", () => {
      if (this.stopEmitted) return
      this.stopEmitted = true
      if (this.session) {
        this.session.status = "stopped"
        this.session.lastActivity = new Date()
      }
      log.debug("Server stopped")
      this.emit("stopped", this.session)
    })

    this.server.on("terminal:resize", (cols: number, rows: number) => {
      log.debug("Terminal resize", { cols, rows })
      this.emit("terminal:resize", cols, rows)
    })

    this.server.on("terminal:output", (data: string | Buffer) => {
      const output = typeof data === "string" ? data : data.toString("utf8")
      this.emit("terminal:output", output)

      if (this.cloudAgent?.isRelayConnected()) {
        try {
          this.cloudAgent.sendRelayMessage({
            type: "terminal:output",
            payload: { data: output },
            timestamp: Date.now(),
          })
        } catch (error) {
          log.debug("Failed to send relay message", { error })
        }
      }
    })

    try {
      const nativeSession: NativeSession = await this.server.start({
        name: options?.name,
        processForStreaming: {
          stdout: process.stdout,
          stdin: process.stdin,
          input: (data: Buffer) => {
            process.stdin.emit("data", data)
          },
        },
      })

      this.session = {
        id: nativeSession.id,
        name: nativeSession.name,
        qrCode: "",
        qrUrl: nativeSession.qrUrl,
        localUrl: nativeSession.localUrl,
        tunnelUrl: nativeSession.tunnelUrl,
        status: nativeSession.status as SessionStatus,
        connectedDevices: [],
        startedAt: nativeSession.startedAt,
        lastActivity: nativeSession.lastActivity,
        port: nativeSession.port,
      }

      log.info("Session started", {
        sessionId: this.session.id,
        name: this.session.name,
        port: this.session.port,
      })
    } catch (error) {
      log.error("Failed to start session", { error })
      throw error
    }

    try {
      await this.startCloudAgent(options)
    } catch (error) {
      log.error("Failed to start cloud agent, cleaning up", { error })
      await this.server.stop().catch(() => {})
      this.server = null
      if (this.session) {
        this.session.status = "error"
      }
      throw error
    }

    return this.session
  }

  async stop(): Promise<void> {
    log.debug("Stopping session", { sessionId: this.session?.id })

    if (this.cloudAgent) {
      await this.cloudAgent.disconnectRelay().catch((error) => {
        log.debug("Error disconnecting cloud agent", { error })
      })
      this.cloudAgent.removeAllListeners()
      this.cloudAgent = null
    }

    if (this.server) {
      await this.server.stop()
      this.server = null
    }

    if (this.session) {
      this.session.status = "stopped"
    }

    if (!this.stopEmitted) {
      this.stopEmitted = true
      this.emit("stopped", this.session)
    }

    log.info("Session stopped", { sessionId: this.session?.id })
  }

  isActive(): boolean {
    return this.server?.isActive() ?? false
  }

  getSession(): RemoteSession | null {
    return this.session
  }

  broadcast(message: BroadcastMessage): void {
    this.server?.broadcast(message)
  }

  notify(notification: RemoteNotification): void {
    this.server?.notify({
      type:
        notification.type === "task_complete"
          ? "success"
          : notification.type === "error"
            ? "error"
            : notification.type === "action_required"
              ? "warning"
              : "info",
      title: notification.title,
      body: notification.body,
      data: notification.data,
    })
  }

  writeToTerminal(data: string): void {
    this.server?.writeToTerminal(data)
  }

  resizeTerminal(cols: number, rows: number): void {
    this.server?.resizeTerminal(cols, rows)
  }

  getConnectedCount(): number {
    return this.server?.getConnectedCount() ?? 0
  }

  private async startCloudAgent(options?: SessionOptions): Promise<void> {
    if (!options?.cloud?.enabled || !this.session) {
      log.debug("Cloud agent not enabled or no session")
      return
    }

    const { CloudAgent } = await import("@nikcli-ai/remote/cloud-agent")
    const sessionID = options.cloud.sessionID || this.session.id

    log.debug("Starting cloud agent", { sessionID, url: options.cloud.url })

    const agent = new CloudAgent({
      cloudUrl: options.cloud.url,
      token: options.cloud.token,
      deviceID: options.cloud.deviceID,
    })

    agent.on("connected", () => {
      log.info("Cloud agent connected", { sessionID, cloudUrl: options.cloud?.url })
      this.emit("cloud:connected", {
        sessionID,
        cloudUrl: options.cloud?.url,
      })
    })

    agent.on("disconnected", (info: unknown) => {
      log.info("Cloud agent disconnected", { sessionID, info })
      this.emit("cloud:disconnected", info)
    })

    agent.on("message", (payload: unknown) => {
      this.emit("cloud:message", payload)
      this.handleCloudAgentMessage(payload, sessionID)
    })

    agent.on("error", (error: unknown) => {
      log.error("Cloud agent error", { error })
      this.emit("cloud:error", error)
    })

    if (options.cloud.publicKey) {
      try {
        await agent.registerDevice({
          name: "nikcli-desktop",
          platform: "desktop",
          publicKey: options.cloud.publicKey,
        })
        log.debug("Device registered with cloud agent")
      } catch (error) {
        log.error("Failed to register device", { error })
      }
    }

    this.cloudAgent = agent

    try {
      await agent.connectRelay(sessionID)
      log.info("Connected to cloud relay", { sessionID })
    } catch (error) {
      log.error("Failed to connect to cloud relay", { error })
      this.cloudAgent = null
      throw error
    }
  }

  private handleCloudAgentMessage(payload: unknown, sessionID: string): void {
    if (this.server && payload && typeof payload === "object") {
      const body = payload as RelayTerminalMessage
      if (body.sessionID && body.sessionID !== sessionID) return

      const messageType = body.body?.type
      if (messageType === "terminal:input" || messageType === "terminal.input") {
        const input = body.body?.payload?.data
        if (typeof input === "string") {
          this.server.sendInputToTerminal(input)
        }
      }

      if (messageType === "terminal:resize" || messageType === "terminal.resize") {
        const cols = body.body?.payload?.cols
        const rows = body.body?.payload?.rows
        if (typeof cols === "number" && typeof rows === "number") {
          this.server.resizeTerminal(cols, rows)
        }
      }
    }
  }
}
