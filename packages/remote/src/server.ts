import { EventEmitter } from "node:events"
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import { WebSocketServer, WebSocket, type RawData } from "ws"
import crypto from "node:crypto"
import os from "node:os"
import fs from "node:fs"
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

function getGhosttyScript(): string | null {
  if (ghosttyScriptCache) return ghosttyScriptCache
  try {
    // Use UMD build for browser - it uses IIFE format, not ESM
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
    // Direct path to WASM - more reliable than require.resolve
    const directPath = path.join(__dirname, "..", "node_modules", "ghostty-web", "dist", "ghostty-vt.wasm")
    if (fs.existsSync(directPath)) {
      ghosttyWasmCache = fs.readFileSync(directPath)
      return ghosttyWasmCache
    }
    // Fallback to require.resolve
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
  "terminal:output": (data: string) => void
  "terminal:input": (clientId: string, data: string) => void
  "terminal:resize": (cols: number, rows: number) => void
}

export class RemoteServer extends EventEmitter {
  private config: ServerConfig
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private clients: Map<string, ClientConnection & { ws: WebSocket }> = new Map()
  private session: RemoteSession | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private sessionTimeoutTimer: NodeJS.Timeout | null = null
  private isRunning = false
  private sessionSecret: string
  private ptyInput: ((data: Buffer) => void) | null = null
  private terminalOutputBuffer: string[] = []
  private terminalOutputBufferLimit = 200

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
    this.wss = new WebSocketServer({ server: this.httpServer })
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
    const originalWrite = stdout.write.bind(stdout)

    stdout.write = ((
      data: string | Uint8Array,
      encoding?: BufferEncoding | undefined,
      cb?: (err?: Error | null) => void,
    ): boolean => {
      const result = originalWrite(data, encoding, cb)
      const text = data instanceof Buffer ? data.toString() : data
      const formatted = this.formatOutput(String(text))
      this.broadcastToAll({ type: MessageTypes.TERMINAL_OUTPUT, payload: { data: formatted } })
      this.emit("terminal:output", formatted)
      return result
    }) as typeof stdout.write

    this.ptyInput = (data: Buffer) => {
      stdin.emit("data", data)
    }
  }

  private formatOutput(text: string): string {
    if (this.config.outputMode === "clean") {
      return this.cleanOutputForMobile(text)
    }
    return text
  }

  private cleanOutputForMobile(text: string): string {
    let result = ""
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (!ch) continue
      const nextCh = text[i + 1]

      if (ch === "\x1b" && nextCh === "[") {
        let j = i + 2
        while (j < text.length) {
          const charAtJ = text[j]
          if (!charAtJ) break
          if (/[A-Za-z]/.test(charAtJ)) break
          j++
        }
        if (j < text.length) {
          const params = text.slice(i + 2, j)
          const final = text[j]
          if (final && final === "m" && /^[0-9;]*$/.test(params)) {
            result += text.slice(i, j + 1)
          }
          i = j
          continue
        }
      }

      if (ch === "\r") continue
      const code = ch.charCodeAt(0)
      if (code < 0x20 || code === 0x7f) {
        if (ch === "\n" || ch === "\t") result += ch
        continue
      }
      result += ch
    }

    return result
  }

  private setupPtyProxy(pty: {
    stdout: NodeJS.ReadStream
    stdin: NodeJS.WriteStream
    pid: number
    resize: (cols: number, rows: number) => void
    onData: (callback: (data: Buffer) => void) => void
  }): void {
    // Catch output from PTY and broadcast to clients
    pty.stdout.on("data", (data: Buffer) => {
      const text = data.toString()
      const formatted = this.formatOutput(text)
      this.broadcastToAll({ type: MessageTypes.TERMINAL_OUTPUT, payload: { data: formatted } })
      this.emit("terminal:output", formatted)
    })

    // Forward input from clients to PTY
    pty.onData((data: Buffer) => {
      const text = data.toString()
      const formatted = this.formatOutput(text)
      this.broadcastToAll({ type: MessageTypes.TERMINAL_OUTPUT, payload: { data: formatted } })
      this.emit("terminal:output", formatted)
    })

    // Set up input handler
    this.ptyInput = (data: Buffer) => {
      pty.stdin.write(data)
    }

    // Set up resize handler
    const originalResize = this.resizeTerminal
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

    this.broadcastToAll({ type: MessageTypes.SESSION_END, payload: {} })

    for (const client of this.clients.values()) {
      client.ws.close(1000, "Server shutting down")
    }
    this.clients.clear()

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
    if (message.type === MessageTypes.TERMINAL_OUTPUT) {
      const payload = message.payload as { data?: string } | undefined
      if (typeof payload?.data === "string" && payload.data.length > 0) {
        this.cacheTerminalOutput(payload.data)
      }
    }

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
    let count = 0
    for (const client of this.clients.values()) {
      if (client.authenticated) count++
    }
    return count
  }

  writeToClients(data: string): void {
    const formatted = this.formatOutput(data)
    this.broadcastToAll({ type: MessageTypes.TERMINAL_OUTPUT, payload: { data: formatted } })
    this.emit("terminal:output", formatted)
  }

  writeToTerminal(data: string): void {
    this.writeToClients(data)
  }

  sendInputToTerminal(data: string): void {
    if (!this.ptyInput) return
    if (typeof data !== "string" || data.length === 0) return
    this.ptyInput(Buffer.from(data))
    this.emit("terminal:input", "cloud", data)
  }

  resizeTerminal(cols: number, rows: number): void {
    if (typeof cols !== "number" || typeof rows !== "number") return
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    if (cols < 1 || rows < 1) return
    this.emit("terminal:resize", cols, rows)
  }

  private setupWebSocketHandlers(): void {
    this.wss!.on("connection", (ws, req) => {
      const clientId = this.generateClientId()

      const client: ClientConnection & { ws: WebSocket } = {
        id: clientId,
        ws,
        authenticated: false,
        device: {
          id: clientId,
          userAgent: req.headers["user-agent"],
          ip: req.socket.remoteAddress,
          connectedAt: new Date(),
          lastActivity: new Date(),
        },
        lastPing: Date.now(),
      }

      if (this.clients.size >= this.config.maxConnections) {
        ws.close(1013, "Max connections reached")
        return
      }

      this.clients.set(clientId, client)
      ws.send(JSON.stringify({ type: MessageTypes.AUTH_REQUIRED, timestamp: Date.now() }))

      ws.on("message", (data) => {
        try {
          const message: ClientMessage = JSON.parse(data.toString())
          this.handleClientMessage(client, message)
        } catch {}
      })

      ws.on("close", () => {
        this.clients.delete(clientId)
        if (this.session && client.authenticated) {
          this.session.connectedDevices = this.session.connectedDevices.filter((d) => d.id !== clientId)
          if (this.session.connectedDevices.length === 0) {
            this.session.status = "waiting"
          }
          this.emit("client:disconnected", client.device)
        }
      })

      ws.on("error", (error) => {
        this.emit("client:error", clientId, error)
      })

      ws.on("pong", () => {
        client.lastPing = Date.now()
      })
    })
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
      case MessageTypes.AUTH:
        this.handleAuth(client, message.token as string)
        break
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

  private handleAuth(client: ClientConnection & { ws: WebSocket }, token: string): void {
    if (token === this.sessionSecret) {
      client.authenticated = true

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
    } else {
      client.ws.send(JSON.stringify({ type: MessageTypes.AUTH_FAILED, timestamp: Date.now() }))
      setTimeout(() => client.ws.close(1008, "Authentication failed"), 100)
    }
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || "/", `http://${req.headers.host}`)
    const reqPath = url.pathname

    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    if (reqPath === "/ghostty-web.js") {
      const script = getGhosttyScript()
      if (!script) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
        res.end("ghostty-web not installed")
        return
      }
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
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
        "Cache-Control": "public, max-age=3600",
      })
      res.end(wasm)
      return
    }

    if (reqPath === "/" || reqPath === "/index.html") {
      const htmlPath = path.join(__dirname, "..", "dist", "client", "index.html")
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, "utf-8")
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: data: blob:; " +
            "style-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: data: blob: 'wasm-unsafe-eval'; " +
            "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: data: blob:; " +
            "connect-src 'self' ws: wss: https: blob: data:;",
        })
        res.end(html)
        return
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(this.getFallbackHtml())
      return
    }

    if (reqPath === "/manifest.webmanifest") {
      const manifestPath = path.join(__dirname, "..", "public", "manifest.webmanifest")
      if (fs.existsSync(manifestPath)) {
        const manifest = fs.readFileSync(manifestPath, "utf-8")
        res.writeHead(200, {
          "Content-Type": "application/manifest+json; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        })
        res.end(manifest)
        return
      }
      res.writeHead(200, { "Content-Type": "application/manifest+json" })
      res.end(this.getManifest())
      return
    }

    if (reqPath === "/sw.js") {
      const swPath = path.join(__dirname, "..", "public", "sw.js")
      if (fs.existsSync(swPath)) {
        const sw = fs.readFileSync(swPath, "utf-8")
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        })
        res.end(sw)
        return
      }
      res.writeHead(200, { "Content-Type": "application/javascript" })
      res.end(this.getServiceWorker())
      return
    }

    const clientDistPath = path.join(__dirname, "..", "dist", "client", reqPath)
    if (fs.existsSync(clientDistPath) && fs.statSync(clientDistPath).isFile()) {
      const ext = path.extname(reqPath)
      const contentTypes: Record<string, string> = {
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      }
      res.writeHead(200, {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      })
      res.end(fs.readFileSync(clientDistPath))
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

    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not Found")
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, client] of this.clients) {
        if (now - client.lastPing > this.config.heartbeatInterval * 2) {
          client.ws.terminate()
          this.clients.delete(id)
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

  private cacheTerminalOutput(data: string): void {
    this.terminalOutputBuffer.push(data)
    if (this.terminalOutputBuffer.length > this.terminalOutputBufferLimit) {
      this.terminalOutputBuffer.splice(0, this.terminalOutputBuffer.length - this.terminalOutputBufferLimit)
    }
  }

  private flushTerminalBuffer(client: ClientConnection & { ws: WebSocket }): void {
    if (client.ws.readyState !== WebSocket.OPEN || this.terminalOutputBuffer.length === 0) return
    const timestamp = Date.now()
    for (const chunk of this.terminalOutputBuffer) {
      client.ws.send(
        JSON.stringify({
          type: MessageTypes.TERMINAL_OUTPUT,
          payload: { data: chunk },
          timestamp,
        }),
      )
    }
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
<body><p>Run 'nikcli remote start' to start a session</p></body>
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
    return `const CACHE_NAME = 'nikcli-remote-v1'
const STATIC_ASSETS = ['/', '/index.html', '/ghostty-web.js', '/ghostty-vt.wasm', '/manifest.webmanifest']

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
