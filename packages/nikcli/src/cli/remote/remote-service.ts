import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  checkTunnelAvailability,
  createTunnel,
  probeTunnel,
  type TunnelProvider,
  type TunnelResult,
} from "@nikcli-ai/remote"
import { SessionManager } from "./session-manager"
import type {
  BroadcastMessage,
  RemoteNotification,
  RemoteServiceConfig,
  RemoteSession,
  RemoteSessionPersistence,
  ResolvedRemoteSession,
  SessionOptions,
  SessionStatus,
  TaskInfo,
} from "./types"

type SessionSnapshot = {
  id?: string
  name?: string
  status?: SessionStatus
  connectedDevices?: number
  startedAt?: string
  lastActivity?: string
  port?: number
}

const DEFAULT_TUNNEL_PROVIDERS: TunnelProvider[] = ["localtunnel", "cloudflared", "ngrok", "remotosh"]

export class RemoteService extends EventEmitter {
  private static instance: RemoteService
  private initialized = false
  private sessionManager: SessionManager | null = null
  private config: RemoteServiceConfig
  private configPath: string
  private sessionsDir: string
  private activeTunnel: TunnelResult | null = null
  private handledStoppedSessions = new Set<string>()

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
      throw new Error('Session already active. Stop it first with "nikcli remote-control stop"')
    }

    if (this.sessionManager) {
      this.sessionManager.removeAllListeners()
    }

    this.handledStoppedSessions.clear()
    this.sessionManager = new SessionManager(this.config)

    this.sessionManager.on("status:change", (session: RemoteSession) => {
      void this.persistSession(session)
      this.emit("session:status", session)
    })

    this.sessionManager.on("device:connected", (session: RemoteSession, device: any) => {
      void this.persistSession(session)
      this.emit("device:connected", session, device)
    })

    this.sessionManager.on("device:disconnected", (session: RemoteSession, device: any) => {
      void this.persistSession(session)
      this.emit("device:disconnected", session, device)
    })

    this.sessionManager.on("error", (error: Error) => {
      this.emit("session:error", error)
    })

    this.sessionManager.on("terminal:output", (data: string) => {
      this.broadcastToClients(data)
    })

    this.sessionManager.on("stopped", (session: RemoteSession | null) => {
      void this.handleSessionStopped(session)
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
    await this.handleSessionStopped(session)
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

  private broadcastToClients(_data: string): void {
    // The server already broadcasts to clients via WebSocket
    // No action needed - this is just for receiving output from server
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
    if (!session?.qrUrl) return ""
    return this.extractTokenFromUrl(session.qrUrl)
  }

  async createSessionTunnel(options: {
    enableTunnel: boolean
    provider?: TunnelProvider
  }): Promise<TunnelProvider | null> {
    const session = this.getSession()
    if (!session) throw new Error("No active session")
    if (!options.enableTunnel) return null
    if (options.provider === "none") return null

    const port = session.port ?? this.getServerPort()
    if (!port) {
      throw new Error("Tunnel unavailable; missing server port")
    }

    const providers = await this.getTunnelCandidates(options.provider)
    if (providers.length === 0) {
      return null
    }

    const sessionToken = this.extractTokenFromUrl(session.qrUrl)
    if (!sessionToken) {
      throw new Error("Tunnel unavailable; missing session token")
    }

    await this.closeTunnel()

    for (const provider of providers) {
      const result = await createTunnel(port, provider).catch(() => null)
      if (!result) continue

      const tunnelUrl = this.buildSessionUrl(result.url, session.id, sessionToken)
      const reachable = await probeTunnel(tunnelUrl)
      if (!reachable) {
        await result.close().catch(() => {})
        continue
      }

      this.activeTunnel = result
      session.tunnelUrl = tunnelUrl
      session.qrUrl = tunnelUrl
      await this.persistSession(session)
      return provider
    }

    return null
  }

  async closeTunnel(): Promise<void> {
    if (this.activeTunnel) {
      await this.activeTunnel.close().catch(() => {})
      this.activeTunnel = null
    }

    const session = this.getSession()
    if (!session?.tunnelUrl || !session.localUrl) return

    const token = this.extractTokenFromUrl(session.qrUrl)
    session.tunnelUrl = undefined
    session.qrUrl = this.buildSessionUrl(session.localUrl, session.id, token)
    await this.persistSession(session)
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

  async resolveSession(sessionId?: string): Promise<ResolvedRemoteSession | null> {
    const active = this.getSession()
    if (active && active.status !== "stopped") {
      if (!sessionId || active.id === sessionId) {
        return {
          source: "memory",
          session: active,
        }
      }
    }

    return this.getLivePersistedSession(sessionId)
  }

  async listPersistedSessions(): Promise<RemoteSessionPersistence[]> {
    if (!fs.existsSync(this.sessionsDir)) return []

    const result: RemoteSessionPersistence[] = []
    for (const file of fs.readdirSync(this.sessionsDir)) {
      if (!file.endsWith(".json")) continue
      const filePath = path.join(this.sessionsDir, file)
      const loaded = this.readPersistedSession(filePath)
      if (loaded) {
        result.push(loaded)
      }
    }

    return result.toSorted((a, b) => {
      const aTs = new Date(a.lastActivity).getTime()
      const bTs = new Date(b.lastActivity).getTime()
      return bTs - aTs
    })
  }

  async getPersistedSession(sessionId: string): Promise<RemoteSessionPersistence | null> {
    const filePath = this.getSessionFilePath(sessionId)
    if (!fs.existsSync(filePath)) return null
    return this.readPersistedSession(filePath)
  }

  async getLivePersistedSession(sessionId?: string): Promise<ResolvedRemoteSession | null> {
    const candidates = await (async () => {
      if (sessionId) {
        const match = await this.getPersistedSession(sessionId)
        return match ? [match] : []
      }
      return this.listPersistedSessions()
    })()

    for (const candidate of candidates) {
      const snapshot = await this.fetchPersistedSessionSnapshot(candidate)
      if (!snapshot) {
        await this.cleanupPersistedSession(candidate.sessionId)
        continue
      }

      const status = snapshot.status ?? candidate.status
      if (status === "stopped") {
        await this.cleanupPersistedSession(candidate.sessionId)
        continue
      }

      const now = new Date().toISOString()
      const merged: RemoteSessionPersistence = {
        ...candidate,
        name: snapshot.name ?? candidate.name,
        status,
        startedAt: snapshot.startedAt ?? candidate.startedAt,
        lastActivity: snapshot.lastActivity ?? now,
        port: snapshot.port ?? candidate.port,
        localUrl: candidate.localUrl ?? this.deriveLocalUrl(candidate),
      }

      const hydrated = this.hydratePersistedSession(merged, snapshot)
      await this.persistSessionRecord(merged)

      return {
        source: "persisted",
        session: hydrated,
        persisted: merged,
      }
    }

    return null
  }

  async stopPersistedSession(sessionId: string): Promise<boolean> {
    const session = await this.getPersistedSession(sessionId)
    if (!session) return false

    const controlURL = this.buildControlURL(session, "/api/control/stop")
    if (!controlURL) return false

    const token = this.extractTokenFromUrl(session.qrUrl)
    if (token) {
      controlURL.searchParams.set("t", token)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)

    const response = await fetch(controlURL, {
      method: "POST",
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : undefined,
      signal: controller.signal,
    }).catch(() => null)

    clearTimeout(timeout)

    if (!response) {
      return false
    }

    if (response.ok) {
      await this.cleanupPersistedSession(sessionId)
      return true
    }

    if (response.status === 404 || response.status === 410) {
      await this.cleanupPersistedSession(sessionId)
    }

    return false
  }

  async removePersistedSession(sessionId: string): Promise<void> {
    await this.cleanupPersistedSession(sessionId)
  }

  private async handleSessionStopped(session: RemoteSession | null): Promise<void> {
    const sessionId = session?.id
    if (sessionId && this.handledStoppedSessions.has(sessionId)) {
      return
    }
    if (sessionId) {
      this.handledStoppedSessions.add(sessionId)
    }

    await this.closeTunnel()

    if (sessionId) {
      await this.cleanupPersistedSession(sessionId)
    }

    this.emit("session:stopped")
  }

  private async getTunnelCandidates(preferred?: TunnelProvider): Promise<TunnelProvider[]> {
    if (preferred && preferred !== "none") {
      return (await checkTunnelAvailability(preferred)) ? [preferred] : []
    }

    const available: TunnelProvider[] = []
    for (const candidate of DEFAULT_TUNNEL_PROVIDERS) {
      if (await checkTunnelAvailability(candidate)) {
        available.push(candidate)
      }
    }
    return available
  }

  private buildSessionUrl(baseUrl: string, sessionId: string, token?: string): string {
    const url = new URL(baseUrl)
    url.searchParams.set("s", sessionId)
    if (token) {
      url.searchParams.set("t", token)
    }
    return url.toString()
  }

  private hydratePersistedSession(session: RemoteSessionPersistence, snapshot?: SessionSnapshot): RemoteSession {
    const startedAt = this.safeDate(snapshot?.startedAt ?? session.startedAt)
    const lastActivity = this.safeDate(snapshot?.lastActivity ?? session.lastActivity)
    const connectedCount = Math.max(0, snapshot?.connectedDevices ?? 0)

    return {
      id: snapshot?.id ?? session.sessionId,
      name: snapshot?.name ?? session.name,
      qrCode: "",
      qrUrl: session.tunnelUrl || session.qrUrl,
      localUrl: session.localUrl ?? this.deriveLocalUrl(session),
      tunnelUrl: session.tunnelUrl,
      tunnelPassword: session.tunnelPassword,
      status: snapshot?.status ?? session.status,
      connectedDevices: Array.from({ length: connectedCount }, (_, index) => ({
        id: `remote-${index + 1}`,
        connectedAt: lastActivity,
        lastActivity,
      })),
      startedAt,
      lastActivity,
      port: snapshot?.port ?? session.port,
    }
  }

  private safeDate(input: string): Date {
    const parsed = new Date(input)
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  private deriveLocalUrl(session: RemoteSessionPersistence): string | undefined {
    if (session.localUrl) return session.localUrl

    try {
      const parsed = new URL(session.qrUrl)
      return parsed.origin
    } catch {
      if (session.port) {
        return `http://127.0.0.1:${session.port}`
      }
      return undefined
    }
  }

  private extractTokenFromUrl(url: string): string {
    try {
      return new URL(url).searchParams.get("t") || ""
    } catch {
      return ""
    }
  }

  private buildControlURL(session: RemoteSessionPersistence, endpoint: string): URL | null {
    const localUrl = session.localUrl ?? this.deriveLocalUrl(session)
    if (!localUrl) return null
    try {
      return new URL(endpoint, localUrl)
    } catch {
      return null
    }
  }

  private async fetchPersistedSessionSnapshot(session: RemoteSessionPersistence): Promise<SessionSnapshot | null> {
    const token = this.extractTokenFromUrl(session.qrUrl)
    const headers = token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined

    const controlURL = this.buildControlURL(session, "/api/control/status")
    if (controlURL) {
      if (token) {
        controlURL.searchParams.set("t", token)
      }
      const control = await this.fetchJSON(controlURL, headers)
      if (control && typeof control === "object") {
        const payload =
          "session" in control && control.session && typeof control.session === "object" ? control.session : control
        const normalized = this.normalizeSessionSnapshot(payload)
        if (normalized) return normalized
      }
    }

    const legacyURL = this.buildControlURL(session, "/api/session")
    if (!legacyURL) return null
    const legacy = await this.fetchJSON(legacyURL)
    if (!legacy || typeof legacy !== "object") return null
    return this.normalizeSessionSnapshot(legacy)
  }

  private normalizeSessionSnapshot(input: unknown): SessionSnapshot | null {
    if (!input || typeof input !== "object") return null
    const value = input as Record<string, unknown>

    const status = typeof value.status === "string" ? (value.status as SessionStatus) : undefined
    const id = typeof value.id === "string" ? value.id : undefined
    const name = typeof value.name === "string" ? value.name : undefined
    const connectedDevicesRaw = value.connectedDevices
    const connectedDevices =
      typeof connectedDevicesRaw === "number" && Number.isFinite(connectedDevicesRaw)
        ? Math.max(0, Math.floor(connectedDevicesRaw))
        : undefined

    const startedAt = typeof value.startedAt === "string" ? value.startedAt : undefined
    const lastActivity = typeof value.lastActivity === "string" ? value.lastActivity : undefined
    const portRaw = value.port
    const port = typeof portRaw === "number" && Number.isFinite(portRaw) ? Math.max(0, Math.floor(portRaw)) : undefined

    if (!status && !id && !name && connectedDevices === undefined) return null

    return {
      id,
      name,
      status,
      connectedDevices,
      startedAt,
      lastActivity,
      port,
    }
  }

  private async fetchJSON(url: URL, headers?: Record<string, string>): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3500)

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      })

      if (!response.ok) return null
      return await response.json().catch(() => null)
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  private readPersistedSession(filePath: string): RemoteSessionPersistence | null {
    try {
      const data = fs.readFileSync(filePath, "utf-8")
      const parsed = JSON.parse(data) as Partial<RemoteSessionPersistence>
      if (!parsed || typeof parsed !== "object") return null
      if (!parsed.sessionId || !parsed.name || !parsed.qrUrl) return null
      if (!parsed.startedAt || !parsed.lastActivity || !parsed.status) return null

      return {
        sessionId: parsed.sessionId,
        name: parsed.name,
        qrUrl: parsed.qrUrl,
        localUrl: parsed.localUrl,
        tunnelUrl: parsed.tunnelUrl,
        tunnelPassword: parsed.tunnelPassword,
        startedAt: parsed.startedAt,
        lastActivity: parsed.lastActivity,
        status: parsed.status,
        port: parsed.port,
      }
    } catch {
      return null
    }
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
        const session = this.readPersistedSession(filePath)
        if (!session) {
          fs.unlinkSync(filePath)
          continue
        }

        const startedAt = new Date(session.startedAt)
        const now = new Date()
        const ageSeconds = (now.getTime() - startedAt.getTime()) / 1000
        if (ageSeconds > this.config.sessionExpiry) {
          fs.unlinkSync(filePath)
        }
      }
    } catch {
      // ignore
    }
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`)
  }

  private async persistSessionRecord(session: RemoteSessionPersistence): Promise<void> {
    try {
      const filePath = this.getSessionFilePath(session.sessionId)
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
    } catch {
      // ignore
    }
  }

  private async persistSession(session: RemoteSession): Promise<void> {
    const data: RemoteSessionPersistence = {
      sessionId: session.id,
      name: session.name,
      qrUrl: session.qrUrl,
      localUrl: session.localUrl,
      tunnelUrl: session.tunnelUrl,
      tunnelPassword: session.tunnelPassword,
      startedAt: session.startedAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      status: session.status,
      port: session.port,
    }

    await this.persistSessionRecord(data)
  }

  private async cleanupPersistedSession(sessionId: string): Promise<void> {
    try {
      const filePath = this.getSessionFilePath(sessionId)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // ignore
    }
  }
}

export const remoteService = RemoteService.getInstance()
