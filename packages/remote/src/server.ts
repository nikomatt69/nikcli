import { EventEmitter } from "node:events"
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import crypto from "node:crypto"
import os from "node:os"
import fs from "node:fs"
import { promises as fsAsync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type {
  ServerConfig,
  RemoteSession,
  DeviceInfo,
  BroadcastMessage,
  RemoteNotification,
  ClientConnection,
  ClientMessage,
} from "./types"
import { DEFAULT_CONFIG, MessageTypes } from "./types"

const require = createRequire(import.meta.url)
let ghosttyScriptCache: string | null = null
let ghosttyWasmCache: Buffer | null = null

const ASSET_CACHE = new Map<string, { data: Buffer | string; type: string }>()

function getGhosttyScript(): string | null {
  if (ghosttyScriptCache) return ghosttyScriptCache
  try {
    const directPath = path.join(__dirname, "..", "node_modules", "ghostty-web", "dist", "ghostty-web.umd.cjs")
    if (fs.existsSync(directPath)) {
      ghosttyScriptCache = fs.readFileSync(directPath, "utf-8")
      return ghosttyScriptCache
    }
    const ghosttyPath = resolveGhosttyAsset("ghostty-web.umd.cjs")
    if (!ghosttyPath) return null
    ghosttyScriptCache = fs.readFileSync(ghosttyPath, "utf-8")
    return ghosttyScriptCache
  } catch (e) {
    console.error("Error loading ghostty-web:", e)
    return null
  }
}

function getGhosttyWasm(): Buffer | null {
  if (ghosttyWasmCache) return ghosttyWasmCache
  try {
    const directPath = path.join(__dirname, "..", "node_modules", "ghostty-web", "dist", "ghostty-vt.wasm")
    if (fs.existsSync(directPath)) {
      ghosttyWasmCache = fs.readFileSync(directPath)
      return ghosttyWasmCache
    }
    const wasmPath = resolveGhosttyAsset("ghostty-vt.wasm")
    if (!wasmPath) return null
    ghosttyWasmCache = fs.readFileSync(wasmPath)
    return ghosttyWasmCache
  } catch (e) {
    console.error("Error loading ghostty wasm:", e)
    return null
  }
}

function resolveGhosttyAsset(filename: string): string | null {
  const candidates: string[] = []

  try {
    const entry = require.resolve("ghostty-web")
    const distDir = path.dirname(entry)
    candidates.push(path.join(distDir, filename))
    candidates.push(path.join(path.dirname(distDir), filename))
  } catch {}

  try {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
    candidates.push(path.join(packageRoot, "node_modules/ghostty-web/dist", filename))
    candidates.push(path.join(packageRoot, "node_modules/ghostty-web", filename))
  } catch {}

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

export interface RemoteServerEvents {
  started: (session: RemoteSession) => void
  stopped: () => void
  "client:connected": (device: DeviceInfo) => void
  "client:disconnected": (device: DeviceInfo) => void
  "client:error": (clientId: string, error: Error) => void
  "tunnel:connected": (url: string) => void
  "tunnel:error": (error: Error) => void
  message: (client: ClientConnection, message: ClientMessage) => void
  error: (error: Error) => void
  "terminal:output": (data: string | Buffer) => void
  "terminal:input": (clientId: string, data: string | Buffer) => void
  "terminal:resize": (cols: number, rows: number) => void
}

export class RemoteServer extends EventEmitter {
  private config: ServerConfig
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private clients: Map<string, ClientConnection & { ws: WebSocket }> = new Map()
  private pendingAuth: Set<WebSocket> = new Set()
  private session: RemoteSession | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private sessionTimeoutTimer: NodeJS.Timeout | null = null
  private isRunning = false
  private sessionSecret: string
  private ptyInput: ((data: Buffer) => void) | null = null
  private restoreStdoutWrite: (() => void) | null = null

  // Redesigned buffer to cap by byte size rather than array length for safety
  private terminalOutputBuffer: Buffer = Buffer.alloc(0)
  private readonly MAX_BUFFER_BYTES = 500 * 1024 // 500KB cap

  constructor(config: Partial<ServerConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sessionSecret = config.sessionSecret || this.generateSecret()
  }

  private generateSecret(): string {
    return crypto.randomBytes(16).toString("hex")
  }

  async start(
    options: {
      name?: string
      processForStreaming?: {
        stdout: NodeJS.WriteStream
        stdin: NodeJS.ReadStream
        input?: (data: Buffer) => void
      }
      pty?: {
        stdout: NodeJS.ReadStream
        stdin: NodeJS.WriteStream
        pid: number
        resize: (cols: number, rows: number) => void
        onData: (callback: (data: Buffer) => void) => void
      }
    } = {},
  ): Promise<RemoteSession> {
    if (this.isRunning) {
      throw new Error("Server already running")
    }

    const sessionId = this.generateSessionId()

    this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res))

    // Add WebSocket payload limit (64KB) to prevent OOM DOS
    this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: 64 * 1024 })
    this.setupWebSocketHandlers()

    const port = await new Promise<number>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        const addr = this.httpServer!.address()
        resolve(typeof addr === "object" ? addr?.port || 0 : 0)
      })
      this.httpServer!.on("error", reject)
    })

    const localIp = this.getLocalIP()
    const localUrl = `http://${localIp}:${port}`

    this.session = {
      id: sessionId,
      name: options.name || `nikcli-${sessionId}`,
      qrCode: "",
      qrUrl: `${localUrl}?s=${sessionId}&t=${this.sessionSecret}`,
      localUrl,
      status: "waiting",
      connectedDevices: [],
      startedAt: new Date(),
      lastActivity: new Date(),
      port,
    }

    if (options.pty) {
      this.setupPtyProxy(options.pty)
    } else if (options.processForStreaming) {
      this.setupStdioProxy(options.processForStreaming.stdout, options.processForStreaming.stdin)
      if (options.processForStreaming.input) {
        this.ptyInput = options.processForStreaming.input
      }
    }

    this.startHeartbeat()

    if (this.config.sessionTimeout > 0) {
      this.startSessionTimeout()
    }

    this.session.status = "waiting"
    this.isRunning = true
    this.emit("started", this.session)

    return this.session
  }

  private setupStdioProxy(stdout: NodeJS.WriteStream, stdin: NodeJS.ReadStream): void {
    if (this.restoreStdoutWrite) {
      this.restoreStdoutWrite()
      this.restoreStdoutWrite = null
    }

    const originalWrite = stdout.write

    stdout.write = ((
      data: string | Uint8Array,
      encoding?: BufferEncoding | undefined,
      cb?: (err?: Error | null) => void,
    ): boolean => {
      const result =
        typeof encoding === "function"
          ? (originalWrite as any).call(stdout, data, encoding)
          : (originalWrite as any).call(stdout, data, encoding, cb)
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as string, encoding || "utf8")
      this.broadcastTerminalData(buf)
      this.emit("terminal:output", buf)
      return result
    }) as typeof stdout.write

    this.restoreStdoutWrite = () => {
      stdout.write = originalWrite
      this.restoreStdoutWrite = null
    }

    this.ptyInput = (data: Buffer) => {
      stdin.emit("data", data)
    }
  }

  private setupPtyProxy(pty: {
    stdout: NodeJS.ReadStream
    stdin: NodeJS.WriteStream
    pid: number
    resize: (cols: number, rows: number) => void
    onData: (callback: (data: Buffer) => void) => void
  }): void {
    pty.stdout.on("data", (data: Buffer) => {
      this.broadcastTerminalData(data)
      this.emit("terminal:output", data)
    })

    pty.onData((data: Buffer) => {
      this.broadcastTerminalData(data)
      this.emit("terminal:output", data)
    })

    this.ptyInput = (data: Buffer) => {
      pty.stdin.write(data)
    }

    this.resizeTerminal = (cols: number, rows: number) => {
      pty.resize(cols, rows)
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return
    this.isRunning = false

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer)
      this.sessionTimeoutTimer = null
    }

    if (this.restoreStdoutWrite) {
      this.restoreStdoutWrite()
    }

    this.broadcastToAll({ type: MessageTypes.SESSION_END, payload: {} })

    for (const client of this.clients.values()) {
      client.ws.close(1000, "Server shutting down")
    }
    this.clients.clear()

    if (this.session) {
      this.session.connectedDevices = []
    }

    for (const ws of this.pendingAuth) {
      ws.close(1000, "Server shutting down")
    }
    this.pendingAuth.clear()

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
      })
      this.httpServer = null
    }

    if (this.session) {
      this.session.status = "stopped"
    }

    this.emit("stopped")
  }

  private broadcastToAll(message: BroadcastMessage): void {
    const data = JSON.stringify({
      type: message.type,
      payload: message.payload,
      timestamp: message.timestamp || Date.now(),
    })

    for (const client of this.clients.values()) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
  }

  private broadcastTerminalData(data: Buffer): void {
    this.cacheTerminalOutput(data)

    // We send binary over WS for max performance, but currently the client expects string JSON.
    // Converting to base64 or string is a fallback if client doesn't support binary frames yet.
    // For now we keep JSON wrapper but send base64 if needed, or just string.
    const textData = data.toString("utf8")
    this.broadcastToAll({
      type: MessageTypes.TERMINAL_OUTPUT,
      payload: { data: textData },
    })
  }

  broadcast(message: BroadcastMessage): void {
    this.broadcastToAll(message)
  }

  notify(notification: RemoteNotification): void {
    this.broadcastToAll({
      type: MessageTypes.NOTIFICATION,
      payload: notification,
    })
  }

  getSession(): RemoteSession | null {
    return this.session
  }

  getSessionSecret(): string {
    return this.sessionSecret
  }

  setPtyInput(handler: (data: Buffer) => void): void {
    this.ptyInput = handler
  }

  isActive(): boolean {
    return this.isRunning && this.session?.status !== "stopped"
  }

  getConnectedCount(): number {
    return this.clients.size
  }

  writeToClients(data: string | Buffer): void {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")
    this.broadcastTerminalData(buf)
    this.emit("terminal:output", buf)
  }

  writeToTerminal(data: string | Buffer): void {
    this.writeToClients(data)
  }

  sendInputToTerminal(data: string | Buffer): void {
    if (!this.ptyInput) return
    if (!data || data.length === 0) return
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")
    this.ptyInput(buf)
    this.emit("terminal:input", "cloud", buf)
  }

  resizeTerminal(cols: number, rows: number): void {
    if (typeof cols !== "number" || typeof rows !== "number") return
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    if (cols < 1 || rows < 1) return
    this.emit("terminal:resize", cols, rows)
  }

  private disconnectClient(
    clientId: string,
    options?: {
      closeSocket?: boolean
      terminate?: boolean
      closeCode?: number
      reason?: string
    },
  ): void {
    const client = this.clients.get(clientId)
    if (!client) return

    this.clients.delete(clientId)

    if (this.session) {
      this.session.connectedDevices = this.session.connectedDevices.filter((d) => d.id !== clientId)
      if (this.session.connectedDevices.length === 0) {
        this.session.status = "waiting"
      }
      this.emit("client:disconnected", client.device)
    }

    if (options?.closeSocket === false) return

    try {
      if (options?.terminate) {
        client.ws.terminate()
      } else if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) {
        client.ws.close(options?.closeCode ?? 1000, options?.reason ?? "Disconnected")
      }
    } catch {
      // ignore close errors
    }
  }

  private isControlRequestAuthorized(req: IncomingMessage, url: URL): boolean {
    const authHeader = req.headers.authorization
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined
    const queryToken = url.searchParams.get("t") ?? undefined
    const token = bearerToken || queryToken
    if (!token) return false
    return token === this.sessionSecret
  }

  private currentSessionPayload() {
    return {
      id: this.session?.id,
      name: this.session?.name,
      status: this.session?.status,
      connectedDevices: this.session?.connectedDevices.length ?? 0,
      startedAt: this.session?.startedAt,
      lastActivity: this.session?.lastActivity,
      port: this.session?.port,
    }
  }

  private setupWebSocketHandlers(): void {
    this.wss!.on("connection", (ws, req) => {
      // Pending Auth Timeout (DoS Protection)
      this.pendingAuth.add(ws)
      const authTimeout = setTimeout(() => {
        if (this.pendingAuth.has(ws)) {
          ws.close(1008, "Authentication timeout")
          this.pendingAuth.delete(ws)
        }
      }, 5000)

      ws.on("message", (data) => {
        if (this.pendingAuth.has(ws)) {
          try {
            const message: ClientMessage = JSON.parse(data.toString())
            if (message.type === MessageTypes.AUTH) {
              clearTimeout(authTimeout)
              this.handleAuth(ws, req, message.token as string)
            } else {
              ws.close(1008, "Authentication required")
            }
          } catch {
            ws.close(1008, "Invalid payload")
          }
          return
        }

        // Authenticated client
        const clientId = (ws as any).__clientId
        const client = this.clients.get(clientId)
        if (!client) return

        try {
          const message: ClientMessage = JSON.parse(data.toString())
          this.handleClientMessage(client, message)
        } catch (err) {
          // Log parsing errors
          console.error(`Malformed WS payload from ${clientId}:`, err)
        }
      })

      ws.on("close", () => {
        clearTimeout(authTimeout)
        this.pendingAuth.delete(ws)

        const clientId = (ws as any).__clientId
        if (clientId) {
          this.disconnectClient(clientId, { closeSocket: false })
        }
      })

      ws.on("error", (error) => {
        const clientId = (ws as any).__clientId
        if (clientId) {
          this.emit("client:error", clientId, error)
        }
      })

      ws.send(JSON.stringify({ type: MessageTypes.AUTH_REQUIRED, timestamp: Date.now() }))
    })
  }

  private handleAuth(ws: WebSocket, req: IncomingMessage, token: string): void {
    if (token === this.sessionSecret) {
      if (this.clients.size >= this.config.maxConnections) {
        ws.close(1013, "Max connections reached")
        this.pendingAuth.delete(ws)
        return
      }

      this.pendingAuth.delete(ws)
      const clientId = this.generateClientId()
      ;(ws as any).__clientId = clientId

      const client: ClientConnection & { ws: WebSocket } = {
        id: clientId,
        ws,
        authenticated: true,
        device: {
          id: clientId,
          userAgent: req.headers["user-agent"],
          ip: req.socket.remoteAddress,
          connectedAt: new Date(),
          lastActivity: new Date(),
        },
        lastPing: Date.now(),
      }

      this.clients.set(clientId, client)

      if (this.session) {
        this.session.connectedDevices.push(client.device)
        this.session.status = "connected"
      }

      client.ws.send(
        JSON.stringify({
          type: MessageTypes.AUTH_SUCCESS,
          payload: { sessionId: this.session?.id },
          timestamp: Date.now(),
        }),
      )

      this.flushTerminalBuffer(client)
      this.emit("client:connected", client.device)

      // Setup pong listener
      ws.on("pong", () => {
        client.lastPing = Date.now()
      })
    } else {
      ws.send(JSON.stringify({ type: MessageTypes.AUTH_FAILED, timestamp: Date.now() }))
      setTimeout(() => ws.close(1008, "Authentication failed"), 100)
      this.pendingAuth.delete(ws)
    }
  }

  private handleClientMessage(client: ClientConnection & { ws: WebSocket }, message: ClientMessage): void {
    client.device.lastActivity = new Date()
    if (this.session) {
      this.session.lastActivity = new Date()
    }

    if (this.config.sessionTimeout > 0) {
      this.resetSessionTimeout()
    }

    switch (message.type) {
      case MessageTypes.TERMINAL_INPUT:
        {
          const payload = message.payload as { data?: string } | undefined
          const legacyData = (message as { data?: unknown }).data
          const inputData =
            typeof payload?.data === "string" ? payload.data : typeof legacyData === "string" ? legacyData : undefined
          if (inputData && this.ptyInput) {
            this.ptyInput(Buffer.from(inputData))
          }
          this.emit("terminal:input", client.id, inputData || "")
        }
        break
      case MessageTypes.TERMINAL_RESIZE:
        {
          const payload = message.payload as { cols?: number; rows?: number } | undefined
          const legacy = message as { cols?: unknown; rows?: unknown }
          const rawCols = payload?.cols ?? legacy.cols
          const rawRows = payload?.rows ?? legacy.rows
          const cols = typeof rawCols === "number" ? rawCols : Number(rawCols)
          const rows = typeof rawRows === "number" ? rawRows : Number(rawRows)
          if (Number.isFinite(cols) && Number.isFinite(rows)) {
            this.resizeTerminal(cols, rows)
          }
          this.emit("message", client, message)
        }
        break
      case MessageTypes.PING:
        client.ws.send(JSON.stringify({ type: MessageTypes.PONG, timestamp: Date.now() }))
        break
      default:
        this.emit("message", client, message)
    }
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`)
    const reqPath = url.pathname

    // Hardened CORS
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("X-Frame-Options", "DENY")
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' wss: ws: https: data: blob:;",
    )

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      if (reqPath === "/ghostty-web.js") {
        const script = getGhosttyScript()
        if (!script) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
          res.end("ghostty-web not installed")
          return
        }
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        })
        res.end(script)
        return
      }

      if (reqPath === "/ghostty-vt.wasm") {
        const wasm = getGhosttyWasm()
        if (!wasm) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
          res.end("ghostty wasm not installed")
          return
        }
        res.writeHead(200, {
          "Content-Type": "application/wasm",
          "Cache-Control": "public, max-age=86400",
        })
        res.end(wasm)
        return
      }

      if (reqPath === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", session: this.session?.id }))
        return
      }

      if (reqPath === "/api/session") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            id: this.session?.id,
            name: this.session?.name,
            status: this.session?.status,
            connectedDevices: this.session?.connectedDevices.length,
          }),
        )
        return
      }

      if (reqPath === "/api/control/status") {
        if (!this.isControlRequestAuthorized(req, url)) {
          res.writeHead(401, { "Content-Type": "application/json" })
          res.end(
            JSON.stringify({
              error: "unauthorized",
            }),
          )
          return
        }

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            ok: true,
            session: this.currentSessionPayload(),
          }),
        )
        return
      }

      if (reqPath === "/api/control/stop") {
        if (!this.isControlRequestAuthorized(req, url)) {
          res.writeHead(401, { "Content-Type": "application/json" })
          res.end(
            JSON.stringify({
              error: "unauthorized",
            }),
          )
          return
        }

        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" })
          res.end(
            JSON.stringify({
              error: "method_not_allowed",
            }),
          )
          return
        }

        res.writeHead(202, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            ok: true,
          }),
        )

        setTimeout(() => {
          void this.stop()
        }, 10)
        return
      }

      // Safe Static File Serving
      const basePath = path.resolve(__dirname, "..", "dist", "client")
      let targetPath = path.normalize(path.join(basePath, reqPath === "/" ? "index.html" : reqPath))

      // Path Traversal Protection
      if (!targetPath.startsWith(basePath)) {
        res.writeHead(403)
        res.end("Forbidden")
        return
      }

      // Serve from cache if available
      if (ASSET_CACHE.has(targetPath)) {
        const cached = ASSET_CACHE.get(targetPath)!
        res.writeHead(200, {
          "Content-Type": cached.type,
          "Cache-Control": "public, max-age=3600",
        })
        res.end(cached.data)
        return
      }

      // Check existence async
      try {
        const stats = await fsAsync.stat(targetPath)
        if (stats.isFile()) {
          const ext = path.extname(targetPath)
          const contentTypes: Record<string, string> = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".wasm": "application/wasm",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".webmanifest": "application/manifest+json",
          }
          const type = contentTypes[ext] || "application/octet-stream"
          const content = await fsAsync.readFile(targetPath)

          // Cache it
          ASSET_CACHE.set(targetPath, { data: content, type })

          res.writeHead(200, {
            "Content-Type": type,
            "Cache-Control": "public, max-age=3600",
          })
          res.end(content)
          return
        }
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err
      }

      // Fallbacks for known paths if not found in dist
      if (reqPath === "/" || reqPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(this.getFallbackHtml())
        return
      }

      if (reqPath === "/manifest.webmanifest") {
        res.writeHead(200, { "Content-Type": "application/manifest+json" })
        res.end(this.getManifest())
        return
      }

      if (reqPath === "/sw.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" })
        res.end(this.getServiceWorker())
        return
      }

      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not Found")
    } catch (error) {
      console.error("HTTP Server Error:", error)
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" })
        res.end("Internal Server Error")
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, client] of this.clients) {
        if (now - client.lastPing > this.config.heartbeatInterval * 2) {
          this.disconnectClient(id, {
            terminate: true,
            closeCode: 1001,
            reason: "Heartbeat timeout",
          })
        } else if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping()
        }
      }
    }, this.config.heartbeatInterval)
  }

  private startSessionTimeout(): void {
    this.sessionTimeoutTimer = setTimeout(() => {
      if (this.session?.connectedDevices.length === 0) {
        this.stop()
      }
    }, this.config.sessionTimeout)
  }

  private resetSessionTimeout(): void {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer)
    }
    if (this.config.sessionTimeout > 0) {
      this.startSessionTimeout()
    }
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address
        }
      }
    }
    return "127.0.0.1"
  }

  private generateSessionId(): string {
    return crypto.randomBytes(4).toString("hex")
  }

  private generateClientId(): string {
    return "c_" + crypto.randomBytes(4).toString("hex")
  }

  private cacheTerminalOutput(data: Buffer): void {
    this.terminalOutputBuffer = Buffer.concat([this.terminalOutputBuffer, data])
    if (this.terminalOutputBuffer.length > this.MAX_BUFFER_BYTES) {
      this.terminalOutputBuffer = this.terminalOutputBuffer.subarray(
        this.terminalOutputBuffer.length - this.MAX_BUFFER_BYTES,
      )
    }
  }

  private flushTerminalBuffer(client: ClientConnection & { ws: WebSocket }): void {
    if (client.ws.readyState !== WebSocket.OPEN || this.terminalOutputBuffer.length === 0) return
    const timestamp = Date.now()

    // Send cached buffer to the new client
    client.ws.send(
      JSON.stringify({
        type: MessageTypes.TERMINAL_OUTPUT,
        payload: { data: this.terminalOutputBuffer.toString("utf8") },
        timestamp,
      }),
    )
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NikCLI Remote</title>
  <style>
    body { background: #0d1117; color: #e6edf3; font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    p { color: #8b949e; }
  </style>
</head>
<body><p>Run 'nikcli remote-control' to start a session</p></body>
</html>`
  }

  private getManifest(): string {
    return JSON.stringify({
      name: "NikCLI Remote",
      short_name: "NikCLI",
      description: "Control NikCLI from mobile",
      start_url: "/",
      display: "standalone",
      background_color: "#0d1117",
      theme_color: "#0d1117",
    })
  }

  private getServiceWorker(): string {
    return `const CACHE_NAME = 'nikcli-remote-v2'
const STATIC_ASSETS = ['/', '/index.html', '/ghostty-web.js', '/ghostty-vt.wasm']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {})))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))))
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).catch(() => new Response('Offline', { status: 503 })))
})`
  }
}
