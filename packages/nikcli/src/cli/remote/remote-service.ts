import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { SessionManager } from "./session-manager"
import type {
  BroadcastMessage,
  RemoteNotification,
  RemoteServiceConfig,
  RemoteSession,
  RemoteSessionPersistence,
  SessionOptions,
  TaskInfo,
} from "./types"

export class RemoteService extends EventEmitter {
  private static instance: RemoteService
  private initialized = false
  private sessionManager: SessionManager | null = null
  private config: RemoteServiceConfig
  private configPath: string
  private sessionsDir: string

  private constructor() {
    super()
    this.configPath = path.join(os.homedir(), ".nikcli", "remote-config.json")
    this.sessionsDir = path.join(os.homedir(), ".nikcli", "remote-sessions")
    this.config = this.getDefaultConfig()
  }

  static getInstance(): RemoteService {
    if (!RemoteService.instance) {
      RemoteService.instance = new RemoteService()
    }
    return RemoteService.instance
  }

  async init(): Promise<void> {
    if (this.initialized) return

    try {
      await this.ensureDirectories()
      this.config = await this.loadConfig()
      await this.checkRemotoshAvailable()

      if (this.config.autoRecoverSession) {
        await this.recoverPreviousSessions()
      }

      this.initialized = true
      this.emit("ready")
    } catch (error: any) {
      this.emit("error", error)
    }
  }

  isInitialized(): boolean {
    return this.initialized
  }

  async startSession(options?: SessionOptions): Promise<RemoteSession> {
    if (!this.initialized) {
      throw new Error("RemoteService not initialized. Call init() first.")
    }

    if (this.sessionManager?.isActive()) {
      throw new Error('Session already active. Stop it first with "nikcli remote stop"')
    }

    this.sessionManager = new SessionManager(this.config)

    this.sessionManager.on("status:change", (session: RemoteSession) => {
      this.emit("session:status", session)
    })

    this.sessionManager.on("device:connected", (session: RemoteSession, device: any) => {
      this.emit("device:connected", session, device)
    })

    this.sessionManager.on("device:disconnected", (session: RemoteSession, device: any) => {
      this.emit("device:disconnected", session, device)
    })

    this.sessionManager.on("error", (error: Error) => {
      this.emit("session:error", error)
    })

    this.sessionManager.on("terminal:output", (data: string) => {
      this.broadcastToClients(data)
    })

    const session = await this.sessionManager.start(options)
    await this.persistSession(session)

    this.emit("session:started", session)
    return session
  }

  async stopSession(): Promise<void> {
    if (!this.sessionManager?.isActive()) {
      throw new Error("No active session")
    }

    const session = this.sessionManager.getSession()
    await this.sessionManager.stop()

    if (session) {
      await this.cleanupPersistedSession(session.id)
    }

    this.emit("session:stopped")
  }

  getSession(): RemoteSession | null {
    return this.sessionManager?.getSession() ?? null
  }

  hasActiveSession(): boolean {
    return this.sessionManager?.isActive() ?? false
  }

  hasRemoteClients(): boolean {
    const session = this.sessionManager?.getSession()
    return (session?.connectedDevices?.length ?? 0) > 0
  }

  private sanitizeForTunnel(data: string): string {
    return data
  }

  writeToTerminal(data: string): void {
    if (!this.sessionManager?.isActive()) return
    const sanitized = this.sanitizeForTunnel(data)
    this.sessionManager.writeToTerminal(sanitized)
  }

  private broadcastToClients(data: string): void {
    if (!this.sessionManager?.isActive()) return
    const sanitized = this.sanitizeForTunnel(data)
    this.sessionManager.writeToTerminal(sanitized)
  }

  resizeTerminal(cols: number, rows: number): void {
    if (!this.sessionManager?.isActive()) return
    this.sessionManager.resizeTerminal(cols, rows)
  }

  getServerPort(): number {
    return this.sessionManager?.getSession()?.port ?? 0
  }

  getSessionSecret(): string {
    const session = this.sessionManager?.getSession()
    if (session?.qrUrl) {
      try {
        const url = new URL(session.qrUrl)
        return url.searchParams.get("t") || ""
      } catch {
        return ""
      }
    }
    return ""
  }

  broadcast(message: BroadcastMessage): void {
    if (!this.sessionManager?.isActive()) return
    this.sessionManager.broadcast({
      ...message,
      timestamp: message.timestamp ?? Date.now(),
    })
  }

  notify(notification: RemoteNotification): void {
    if (!this.config.notificationsEnabled) return
    this.sessionManager?.notify(notification)
  }

  notifyTaskComplete(task: TaskInfo): void {
    if (!this.config.notificationsEnabled) return
    this.notify({
      type: "task_complete",
      title: `Task Completed: ${task.name}`,
      body: task.summary,
      data: task,
    })
  }

  notifyError(agentName: string, error: string): void {
    if (!this.config.notificationsEnabled) return
    this.notify({
      type: "error",
      title: `Error in ${agentName}`,
      body: error,
    })
  }

  notifyInputRequired(agentName: string, message: string): void {
    if (!this.config.notificationsEnabled) return
    this.notify({
      type: "action_required",
      title: `${agentName} needs input`,
      body: message,
    })
  }

  getConfig(): RemoteServiceConfig {
    return { ...this.config }
  }

  async updateConfig(config: Partial<RemoteServiceConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
    await this.saveConfig()
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = [path.dirname(this.configPath), this.sessionsDir]

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
  }

  private async loadConfig(): Promise<RemoteServiceConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8")
        const loaded = JSON.parse(data)
        return { ...this.getDefaultConfig(), ...loaded }
      }
    } catch {
      // ignore
    }
    return this.getDefaultConfig()
  }

  private async saveConfig(): Promise<void> {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    } catch {
      // ignore
    }
  }

  private getDefaultConfig(): RemoteServiceConfig {
    return {
      notificationsEnabled: true,
      sessionExpiry: 86400,
      maxDevices: 5,
      autoRecoverSession: true,
    }
  }

  private async checkRemotoshAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import("node:child_process")
      execSync("remoto --version", { stdio: "pipe", timeout: 10000 })
      return true
    } catch {
      return false
    }
  }

  private async recoverPreviousSessions(): Promise<void> {
    try {
      if (!fs.existsSync(this.sessionsDir)) return
      const files = fs.readdirSync(this.sessionsDir)
      for (const file of files) {
        if (!file.endsWith(".json")) continue
        const filePath = path.join(this.sessionsDir, file)
        try {
          const data = fs.readFileSync(filePath, "utf-8")
          const session: RemoteSessionPersistence = JSON.parse(data)
          const startedAt = new Date(session.startedAt)
          const now = new Date()
          const ageSeconds = (now.getTime() - startedAt.getTime()) / 1000
          if (ageSeconds > this.config.sessionExpiry) {
            fs.unlinkSync(filePath)
          }
        } catch {
          fs.unlinkSync(filePath)
        }
      }
    } catch {
      // ignore
    }
  }

  private async persistSession(session: RemoteSession): Promise<void> {
    try {
      const data: RemoteSessionPersistence = {
        sessionId: session.id,
        name: session.name,
        qrUrl: session.qrUrl,
        tunnelPassword: session.tunnelPassword,
        startedAt: session.startedAt.toISOString(),
        lastActivity: session.lastActivity.toISOString(),
        status: session.status,
        port: session.port,
      }

      const filePath = path.join(this.sessionsDir, `${session.id}.json`)
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    } catch {
      // ignore
    }
  }

  private async cleanupPersistedSession(sessionId: string): Promise<void> {
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // ignore
    }
  }
}

export const remoteService = RemoteService.getInstance()
