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

type RemoteServer = import("@nikcli-ai/remote").RemoteServer
type NativeSession = import("@nikcli-ai/remote").RemoteSession

export class SessionManager extends EventEmitter {
  private server: RemoteServer | null = null
  private session: RemoteSession | null = null
  private config: RemoteServiceConfig

  constructor(config: RemoteServiceConfig) {
    super()
    this.config = config
  }

  async start(options?: SessionOptions): Promise<RemoteSession> {
    const { RemoteServer } = await import("@nikcli-ai/remote")

    this.server = new RemoteServer({
      port: 0,
      enableTunnel: true,
      tunnelProvider: "localtunnel",
      maxConnections: options?.maxDevices ?? this.config.maxDevices,
      sessionTimeout: this.config.sessionExpiry * 1000,
      enableTerminal: false,
    })

    this.server.on("client:connected", (device: DeviceInfo) => {
      if (!this.session) return
      this.session.connectedDevices.push(device)
      this.session.status = "connected"
      this.session.lastActivity = new Date()
      this.emit("status:change", this.session)
      this.emit("device:connected", this.session, device)
    })

    this.server.on("client:disconnected", (device: DeviceInfo) => {
      if (!this.session) return
      this.session.connectedDevices = this.session.connectedDevices.filter((d) => d.id !== device.id)
      if (this.session.connectedDevices.length === 0) {
        this.session.status = "waiting"
      }
      this.emit("status:change", this.session)
      this.emit("device:disconnected", this.session, device)
    })

    this.server.on("tunnel:connected", (url: string) => {
      if (this.session) {
        this.session.qrUrl = url
        this.emit("tunnel:connected", url)
      }
    })

    this.server.on("tunnel:error", (error: Error) => {
      this.emit("tunnel:error", error)
    })

    this.server.on("error", (error: Error) => {
      this.emit("error", error)
    })

    this.server.on("terminal:resize", (cols: number, rows: number) => {
      this.emit("terminal:resize", cols, rows)
    })

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

    return this.session
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.stop()
      this.server = null
    }

    if (this.session) {
      this.session.status = "stopped"
    }
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
}
