import { decodeImage } from "../native-bridge"
import { detectTerminalCapabilities, browserViewportFromTerminal, clampTerminalViewport, normalizeWebUrl } from "../capabilities"
import { ChromiumCdpBrowserEngine } from "../engine/cdp/chromium"
import { AnsiTerminalRendererBackend } from "../renderer/ansi/backend"
import { BitmapTerminalRendererBackend } from "../renderer/bitmap/backend"
import type {
  BrowserFrame,
  BrowserMouseEvent,
  BrowserKeyboardEvent,
  BrowserViewport,
  CreateTerminalBrowserSessionOptions,
  TerminalBrowserSession,
  TerminalBrowserSnapshot,
  TerminalLine,
  TerminalRendererBackend,
} from "../types"

function blankLines(columns: number, rows: number): TerminalLine[] {
  return Array.from({ length: rows }, () => ({
    segments: [{ text: " ".repeat(columns), fg: "#ffffff", bg: "#000000" }],
  }))
}

class TerminalBrowserSessionImpl implements TerminalBrowserSession {
  private listeners = new Set<(snapshot: TerminalBrowserSnapshot) => void>()
  private snapshot: TerminalBrowserSnapshot
  private renderer: TerminalRendererBackend
  private engine: ChromiumCdpBrowserEngine
  private queuedFrame: BrowserFrame | null = null
  private rendering = false
  private pendingMove: (BrowserMouseEvent & { pixelX: number; pixelY: number }) | null = null
  private pendingScroll: (BrowserMouseEvent & { pixelX: number; pixelY: number }) | null = null
  private moveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: CreateTerminalBrowserSessionOptions) {
    const terminalViewport = clampTerminalViewport(options.viewport?.columns ?? 80, options.viewport?.rows ?? 24)
    const browserViewport = browserViewportFromTerminal(terminalViewport.columns, terminalViewport.rows)
    const capabilities = options.capabilities ?? detectTerminalCapabilities()

    this.renderer = capabilities.supportsBitmap ? new BitmapTerminalRendererBackend() : new AnsiTerminalRendererBackend()
    this.renderer.init(capabilities, browserViewport)
    this.engine = new ChromiumCdpBrowserEngine(browserViewport, options.browserPath)
    this.snapshot = {
      ...this.engine.getState(),
      lines: blankLines(terminalViewport.columns, terminalViewport.rows),
      terminalViewport,
      browserViewport,
      capabilities,
    }

    this.engine.subscribe((state) => {
      this.snapshot = { ...this.snapshot, ...state }
      this.emit()
    })
  }

  async start(initialUrl?: string) {
    await this.engine.start()
    await this.engine.captureFrames((frame) => this.queueFrame(frame))
    if (initialUrl) {
      await this.goto(initialUrl)
    }
  }

  private emit() {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private queueFrame(frame: BrowserFrame) {
    this.queuedFrame = frame
    if (this.rendering) return
    void this.flushFrames()
  }

  private async flushFrames() {
    this.rendering = true
    while (this.queuedFrame) {
      const frame = this.queuedFrame
      this.queuedFrame = null
      const decoded = decodeImage(frame.data)
      const result = this.renderer.renderFrame({
        data: new Uint8ClampedArray(decoded.data),
        width: decoded.width,
        height: decoded.height,
        timestamp: frame.timestamp,
      })
      this.snapshot = { ...this.snapshot, lines: result.lines }
      this.emit()
    }
    this.rendering = false
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      terminalViewport: { ...this.snapshot.terminalViewport },
      browserViewport: { ...this.snapshot.browserViewport },
      capabilities: { ...this.snapshot.capabilities },
      lines: this.snapshot.lines.map((line) => ({
        segments: line.segments.map((segment) => ({ ...segment })),
      })),
    }
  }

  subscribe(listener: (snapshot: TerminalBrowserSnapshot) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async goto(url: string) {
    const normalized = normalizeWebUrl(url)
    if (!normalized) return
    await this.engine.goto(normalized)
  }

  async back() {
    await this.engine.back()
  }

  async forward() {
    await this.engine.forward()
  }

  async reload() {
    await this.engine.reload()
  }

  async setViewport(viewport: { columns: number; rows: number }) {
    const terminalViewport = clampTerminalViewport(viewport.columns, viewport.rows)
    const browserViewport = browserViewportFromTerminal(terminalViewport.columns, terminalViewport.rows)

    this.snapshot = {
      ...this.snapshot,
      terminalViewport,
      browserViewport,
      lines: blankLines(terminalViewport.columns, terminalViewport.rows),
    }
    this.renderer.resize(browserViewport)
    await this.engine.setViewport(browserViewport)
    this.emit()
  }

  private toPixelEvent(event: BrowserMouseEvent) {
    const viewport = this.snapshot.browserViewport
    const pixelX = Math.max(0, Math.min(viewport.pixelWidth - 1, Math.round((event.column / viewport.columns) * viewport.pixelWidth)))
    const pixelY = Math.max(0, Math.min(viewport.pixelHeight - 1, Math.round((event.row / viewport.rows) * viewport.pixelHeight)))
    return { ...event, pixelX, pixelY }
  }

  private flushMouseQueue = async () => {
    if (this.pendingMove) {
      const move = this.pendingMove
      this.pendingMove = null
      await this.engine.sendMouse(move)
    }
    if (this.pendingScroll) {
      const scroll = this.pendingScroll
      this.pendingScroll = null
      await this.engine.sendMouse(scroll)
    }
    this.moveTimer = null
  }

  async sendMouse(event: BrowserMouseEvent) {
    const pixelEvent = this.toPixelEvent(event)
    if (pixelEvent.type === "move") {
      this.pendingMove = pixelEvent
      if (!this.moveTimer) {
        this.moveTimer = setTimeout(() => {
          void this.flushMouseQueue()
        }, 16)
      }
      return
    }

    if (pixelEvent.type === "scroll") {
      this.pendingScroll = pixelEvent
      if (!this.moveTimer) {
        this.moveTimer = setTimeout(() => {
          void this.flushMouseQueue()
        }, 16)
      }
      return
    }

    await this.engine.sendMouse(pixelEvent)
  }

  async sendKeyboard(event: BrowserKeyboardEvent) {
    await this.engine.sendKeyboard(event)
  }

  async dispose() {
    if (this.moveTimer) clearTimeout(this.moveTimer)
    this.renderer.dispose()
    await this.engine.dispose()
  }
}

export async function createTerminalBrowserSession(options: CreateTerminalBrowserSessionOptions = {}) {
  const session = new TerminalBrowserSessionImpl(options)
  await session.start(options.initialUrl)
  return session as TerminalBrowserSession
}
