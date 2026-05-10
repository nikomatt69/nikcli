import { EventEmitter } from "node:events"
import path from "node:path"
import os from "node:os"
import { mkdir } from "node:fs/promises"
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
import { RemoteServiceConfigSchema, RemoteSessionPersistenceSchema, SessionStatusSchema } from "./types"
import { Log } from "@/util/log"

const log = Log.create({ service: "remote-service" })

type SessionSnapshot = {
  id?: string
  name?: string
  status?: SessionStatus
  connectedDevices?: number
  startedAt?: string
  lastActivity?: string
  port?: number
}

const DEFAULT_TUNNEL_PROVIDERS: TunnelProvider[] = [
  "localtunnel",
  "cloudflared",
  "ngrok",
  "remotosh",
]

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
    log.debug("RemoteService instance created", {
      configPath: this.configPath,
      sessionsDir: this.sessionsDir,
    })
  }

  static getInstance(): RemoteService {
    if (!RemoteService.instance) {
      RemoteService.instance = new RemoteService()
    }
    return RemoteService.instance
  }

  async init(): Promise<void> {
    if (this.initialized) {
      log.debug("RemoteService already initialized")
      return
    }

    log.debug("Initializing RemoteService")

    try {
      await this.ensureDirectories()
      this.config = await this.loadConfig()
      await this.checkRemotoshAvailable()

      if (this.config.autoRecoverSession) {
        await this.recoverPreviousSessions()
      }

      this.initialized = true
      log.info("RemoteService initialized successfully")
      this.emit("ready")
    } catch (error) {
      log.error("Failed to initialize RemoteService", { error })
      this.emit("error", error)
    }
  }

  isInitialized(): boolean {
    return this.initialized
  }

  async startSession(options?: SessionOptions): Promise<RemoteSession> {
    if (!this.initialized) {
      const error = new Error("RemoteService not initialized. Call init() first.")
      log.error("Failed to start session", { error: error.message })
      throw error
    }

    if (this.sessionManager?.isActive()) {
      const error = new Error(
        'Session already active. Stop it first with "nikcli remote-control stop"',
      )
      log.error("Failed to start session", { error: error.message })
      throw error
    }

    log.debug("Starting new remote session", { options })

    if (this.sessionManager) {
      this.sessionManager.removeAllListeners()
    }

    this.handledStoppedSessions.clear()
    this.sessionManager = new SessionManager(this.config)

    this.sessionManager.on("status:change", (session: RemoteSession) => {
      log.debug("Session status changed", { sessionId: session.id, status: session.status })
      void this.persistSession(session).catch((e) =>
        log.error("Failed to persist session", { error: e }),
      )
      this.emit("session:status", session)
    })

    this.sessionManager.on(
      "device:connected",
      (session: RemoteSession, device: { id: string }) => {
        log.info("Device connected to session", {
          sessionId: session.id,
          deviceId: device.id,
        })
        void this.persistSession(session).catch((e) =>
          log.error("Failed to persist session", { error: e }),
        )
        this.emit("device:connected", session, device)
      },
    )

    this.sessionManager.on(
      "device:disconnected",
      (session: RemoteSession, device: { id: string }) => {
        log.info("Device disconnected from session", {
          sessionId: session.id,
          deviceId: device.id,
        })
        void this.persistSession(session).catch((e) =>
          log.error("Failed to persist session", { error: e }),
        )
        this.emit("device:disconnected", session, device)
      },
    )

    this.sessionManager.on("error", (error: Error) => {
      log.error("Session manager error", { error: error.message })
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

    log.info("Remote session started", { sessionId: session.id, port: session.port })
    this.emit("session:started", session)
    return session
  }

  async stopSession(): Promise<void> {
    if (!this.sessionManager?.isActive()) {
      const error = new Error("No active session")
      log.error("Failed to stop session", { error: error.message })
      throw error
    }

    const session = this.sessionManager.getSession()
    log.debug("Stopping remote session", { sessionId: session?.id })

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

  writeToTerminal(data: string): void {
    if (!this.sessionManager?.isActive()) return
    this.sessionManager.writeToTerminal(data)
  }

  private broadcastToClients(_data: string): void {
    // The server already broadcasts to clients via WebSocket
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
    if (!session) {
      const error = new Error("No active session")
      log.error("Failed to create tunnel", { error: error.message })
      throw error
    }

    if (!options.enableTunnel) {
      log.debug("Tunnel disabled by options")
      return null
    }

    if (options.provider === "none") {
      log.debug("Tunnel provider set to none")
      return null
    }

    const port = session.port ?? this.getServerPort()
    if (!port) {
      const error = new Error("Tunnel unavailable; missing server port")
      log.error("Failed to create tunnel", { error: error.message })
      throw error
    }

    const providers = await this.getTunnelCandidates(options.provider)
    if (providers.length === 0) {
      log.warn("No tunnel providers available")
      return null
    }

    const sessionToken = this.extractTokenFromUrl(session.qrUrl)
    if (!sessionToken) {
      const error = new Error("Tunnel unavailable; missing session token")
      log.error("Failed to create tunnel", { error: error.message })
      throw error
    }

    log.debug("Creating tunnel", { port, providers })

    await this.closeTunnel()

    for (const provider of providers) {
      const result = await createTunnel(port, provider).catch(() => null)
      if (!result) {
        log.debug("Tunnel creation failed for provider", { provider })
        continue
      }

      const tunnelUrl = this.buildSessionUrl(result.url, session.id, sessionToken)
      const reachable = await probeTunnel(tunnelUrl)
      if (!reachable) {
        log.debug("Tunnel not reachable", { provider, tunnelUrl })
        await result.close().catch(() => {})
        continue
      }

      this.activeTunnel = result
      session.tunnelUrl = tunnelUrl
      session.qrUrl = tunnelUrl
      await this.persistSession(session)
      log.info("Tunnel created successfully", { provider, tunnelUrl })
      return provider
    }

    log.warn("All tunnel providers failed")
    return null
  }

  async closeTunnel(): Promise<void> {
    if (this.activeTunnel) {
      log.debug("Closing active tunnel")
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
    const merged = { ...this.config, ...config }
    const parsed = RemoteServiceConfigSchema.safeParse(merged)
    if (!parsed.success) {
      log.error("Invalid config update", { errors: parsed.error.issues })
      throw new Error("Invalid configuration")
    }

    this.config = parsed.data
    await this.saveConfig()
    log.debug("Config updated", { config: this.config })
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
    if (!(await Bun.file(this.sessionsDir).exists())) {
      return []
    }

    const result: RemoteSessionPersistence[] = []

    try {
      const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: this.sessionsDir }))
      for (const file of files) {
        const filePath = path.join(this.sessionsDir, file)
        const loaded = await this.readPersistedSession(filePath)
        if (loaded) {
          result.push(loaded)
        }
      }
    } catch (error) {
      log.error("Failed to list persisted sessions", { error })
    }

    return result.toSorted((a, b) => {
      const aTs = new Date(a.lastActivity).getTime()
      const bTs = new Date(b.lastActivity).getTime()
      return bTs - aTs
    })
  }

  async getPersistedSession(sessionId: string): Promise<RemoteSessionPersistence | null> {
    const filePath = this.getSessionFilePath(sessionId)
    if (!(await Bun.file(filePath).exists())) return null
    return await this.readPersistedSession(filePath)
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

    try {
      const response = await fetch(controlURL, {
        method: "POST",
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.ok) {
        await this.cleanupPersistedSession(sessionId)
        log.info("Stopped persisted session", { sessionId })
        return true
      }

      if (response.status === 404 || response.status === 410) {
        await this.cleanupPersistedSession(sessionId)
      }

      return false
    } catch (error) {
      log.debug("Failed to stop persisted session", { sessionId, error })
      clearTimeout(timeout)
      return false
    }
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

    log.debug("Handling session stopped", { sessionId })

    await this.closeTunnel()

    if (sessionId) {
      await this.cleanupPersistedSession(sessionId)
    }

    this.emit("session:stopped")
  }

  private async getTunnelCandidates(preferred?: TunnelProvider): Promise<TunnelProvider[]> {
    if (preferred && preferred !== "none") {
      const available = await checkTunnelAvailability(preferred)
      return available ? [preferred] : []
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

  private hydratePersistedSession(
    session: RemoteSessionPersistence,
    snapshot?: SessionSnapshot,
  ): RemoteSession {
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

  private async fetchPersistedSessionSnapshot(
    session: RemoteSessionPersistence,
  ): Promise<SessionSnapshot | null> {
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
          "session" in control && control.session && typeof control.session === "object"
            ? (control as { session: Record<string, unknown> }).session
            : (control as Record<string, unknown>)
        const normalized = this.normalizeSessionSnapshot(payload)
        if (normalized) return normalized
      }
    }

    const legacyURL = this.buildControlURL(session, "/api/session")
    if (!legacyURL) return null
    const legacy = await this.fetchJSON(legacyURL)
    if (!legacy || typeof legacy !== "object") return null
    return this.normalizeSessionSnapshot(legacy as Record<string, unknown>)
  }

  private normalizeSessionSnapshot(input: unknown): SessionSnapshot | null {
    if (!input || typeof input !== "object") return null
    const value = input as Record<string, unknown>

    const statusRaw = value.status
    let status: SessionStatus | undefined
    if (typeof statusRaw === "string") {
      const parsed = SessionStatusSchema.safeParse(statusRaw)
      if (parsed.success) {
        status = parsed.data
      }
    }

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
    const port =
      typeof portRaw === "number" && Number.isFinite(portRaw) ? Math.max(0, Math.floor(portRaw)) : undefined

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

  private async fetchJSON(
    url: URL,
    headers?: Record<string, string>,
  ): Promise<unknown> {
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

  private async readPersistedSession(
    filePath: string,
  ): Promise<RemoteSessionPersistence | null> {
    try {
      const data = await Bun.file(filePath).text()
      const parsed = JSON.parse(data)
      const validated = RemoteSessionPersistenceSchema.safeParse(parsed)
      if (!validated.success) {
        log.debug("Persisted session has invalid format", { filePath })
        return null
      }
      return validated.data
    } catch {
      return null
    }
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = [path.dirname(this.configPath), this.sessionsDir]

    for (const dir of dirs) {
      if (!(await Bun.file(dir).exists())) {
        await mkdir(dir, { recursive: true })
      }
    }
  }

  private async loadConfig(): Promise<RemoteServiceConfig> {
    try {
      if (await Bun.file(this.configPath).exists()) {
        const data = await Bun.file(this.configPath).text()
        const loaded = JSON.parse(data)
        const parsed = RemoteServiceConfigSchema.safeParse(loaded)
        if (parsed.success) {
          log.debug("Config loaded from file")
          return parsed.data
        }
        log.warn("Loaded config is invalid, using defaults", { errors: parsed.error.issues })
      }
    } catch (error) {
      log.debug("Failed to load config, using defaults", { error })
    }
    return this.getDefaultConfig()
  }

  private async saveConfig(): Promise<void> {
    try {
      await Bun.write(this.configPath, JSON.stringify(this.config, null, 2))
    } catch {
      log.error("Failed to save config")
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
      log.debug("Remotosh is available")
      return true
    } catch {
      log.debug("Remotosh is not available")
      return false
    }
  }

  private async recoverPreviousSessions(): Promise<void> {
    try {
      if (!(await Bun.file(this.sessionsDir).exists())) return

      const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: this.sessionsDir }))
      for (const file of files) {
        const filePath = path.join(this.sessionsDir, file)
        const session = await this.readPersistedSession(filePath)
        if (!session) {
          await Bun.file(filePath).delete()
          continue
        }

        const startedAt = new Date(session.startedAt)
        const now = new Date()
        const ageSeconds = (now.getTime() - startedAt.getTime()) / 1000
        if (ageSeconds > this.config.sessionExpiry) {
          await Bun.file(filePath).delete()
        }
      }
    } catch {
      log.debug("Session recovery check completed with errors")
    }
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`)
  }

  private async persistSessionRecord(session: RemoteSessionPersistence): Promise<void> {
    try {
      const filePath = this.getSessionFilePath(session.sessionId)
      await Bun.write(filePath, JSON.stringify(session, null, 2))
    } catch {
      log.error("Failed to persist session record", { sessionId: session.sessionId })
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
      if (await Bun.file(filePath).exists()) {
        await Bun.file(filePath).delete()
        log.debug("Cleaned up persisted session", { sessionId })
      }
    } catch {
      log.error("Failed to cleanup persisted session", { sessionId })
    }
  }
}

export const remoteService = RemoteService.getInstance()
