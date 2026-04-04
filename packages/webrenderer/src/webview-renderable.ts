import { FrameBufferRenderable, type FrameBufferOptions, type RenderContext } from "@opentui/core"
import type { MouseEvent, KeyEvent, PasteEvent } from "@opentui/core"

import { WebViewController, type WebViewState } from "./runtime"
import { mouseDown, mouseUp, mouseMove, mouseWheel, keyDown, insertText, type RgbaBuffer } from "./native-bridge"

// ============================================================================
// Options
// ============================================================================

export interface WebViewOptions extends Omit<FrameBufferOptions, "width" | "height"> {
  url?: string
  controller?: WebViewController
  width?: number | "auto" | `${number}%`
  height?: number | "auto" | `${number}%`
  captureFps?: number
  idleCaptureFps?: number
  respectAlpha?: boolean
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CAPTURE_FPS = 10
const DEFAULT_IDLE_CAPTURE_FPS = 2
const BYTES_PER_PIXEL = 4
const SUPERSAMPLE_ROW_ALIGNMENT = 256

// ============================================================================
// Helpers
// ============================================================================

function computeAlignedBytesPerRow(pixelWidth: number): number {
  const unaligned = pixelWidth * BYTES_PER_PIXEL
  return Math.ceil(unaligned / SUPERSAMPLE_ROW_ALIGNMENT) * SUPERSAMPLE_ROW_ALIGNMENT
}

// ============================================================================
// WebViewRenderable
// ============================================================================

export class WebViewRenderable extends FrameBufferRenderable {
  private _controller: WebViewController
  private _url: string | null
  private _captureFps: number
  private _idleCaptureFps: number
  private _captureTimer: ReturnType<typeof setInterval> | null = null
  private _pixelWidth: number = 0
  private _pixelHeight: number = 0
  private _resolution: { width: number; height: number } | null = null
  private _isFocused: boolean = false
  private _destroyed: boolean = false
  private _unsubscribe: (() => void) | null = null

  constructor(ctx: RenderContext, options: WebViewOptions) {
    const w = typeof options.width === "number" ? options.width : 80
    const h = typeof options.height === "number" ? options.height : 24

    super(ctx, {
      ...options,
      width: w,
      height: h,
      respectAlpha: options.respectAlpha ?? false,
    })

    this._controller = options.controller ?? new WebViewController()
    this._url = options.url ?? null
    this._captureFps = options.captureFps ?? DEFAULT_CAPTURE_FPS
    this._idleCaptureFps = options.idleCaptureFps ?? DEFAULT_IDLE_CAPTURE_FPS

    // Subscribe to controller state changes
    this._unsubscribe = this._controller.subscribe(() => {
      this.requestRender()
    })

    // Register mouse event handlers via setters
    this.onMouseDown = (event: MouseEvent) => this._handleMouseDown(event)
    this.onMouseUp = (event: MouseEvent) => this._handleMouseUp(event)
    this.onMouseMove = (event: MouseEvent) => this._handleMouseMove(event)
    this.onMouseScroll = (event: MouseEvent) => this._handleMouseScroll(event)

    // Start capture loop
    this._startCapture()
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  protected override onResize(width: number, height: number): void {
    super.onResize(width, height)
    this._updateViewport()
    if (this._controller.getSessionId()) {
      this._controller.resize(this._pixelWidth, this._pixelHeight)
    }
  }

  override destroySelf(): void {
    this._destroyed = true
    this._stopCapture()
    this._unsubscribe?.()
    this._controller.destroy()
    super.destroySelf()
  }

  // ==========================================================================
  // Keyboard & Paste (override methods)
  // ==========================================================================

  override handleKeyPress(key: KeyEvent): boolean {
    const sessionId = this._controller.getSessionId()
    if (!sessionId) return false

    let modifiers = 0
    if (key.shift) modifiers |= 1
    if (key.ctrl) modifiers |= 2
    if (key.option) modifiers |= 4
    if (key.meta) modifiers |= 8

    const keyName = key.name ?? key.sequence ?? ""

    if (keyName.length === 1 && !key.ctrl && !key.meta) {
      insertText(sessionId, keyName)
    } else {
      keyDown(sessionId, keyName, modifiers)
    }

    return true
  }

  override handlePaste(event: PasteEvent): void {
    const sessionId = this._controller.getSessionId()
    if (!sessionId) return

    // PasteEvent has bytes, convert to string
    const text = new TextDecoder().decode(event.bytes)
    insertText(sessionId, text)
  }

  // ==========================================================================
  // Viewport & Resolution
  // ==========================================================================

  private _updateViewport(): void {
    const resolution = this._resolution
    if (!resolution || !resolution.width || !resolution.height) return

    const cellWidth = resolution.width / (this._ctx as any).terminalWidth
    const cellHeight = resolution.height / (this._ctx as any).terminalHeight

    this._pixelWidth = Math.floor(this.width * cellWidth)
    this._pixelHeight = Math.floor(this.height * cellHeight)
  }

  setResolution(resolution: { width: number; height: number } | null): void {
    this._resolution = resolution
    this._updateViewport()
  }

  // ==========================================================================
  // Controller
  // ==========================================================================

  get controller(): WebViewController {
    return this._controller
  }

  set controller(ctrl: WebViewController) {
    this._unsubscribe?.()
    this._controller = ctrl
    this._unsubscribe = this._controller.subscribe(() => {
      this.requestRender()
    })
  }

  // ==========================================================================
  // Capture Loop
  // ==========================================================================

  private _startCapture(): void {
    if (this._captureTimer) return

    const interval = Math.round(1000 / this._captureFps)
    this._captureTimer = setInterval(() => {
      this._tick().catch(() => {})
    }, interval)

    this._tick().catch(() => {})
  }

  private _stopCapture(): void {
    if (this._captureTimer) {
      clearInterval(this._captureTimer)
      this._captureTimer = null
    }
  }

  private async _tick(): Promise<void> {
    if (this._destroyed) return

    const sessionId = this._controller.getSessionId()
    if (!sessionId) return

    const fps = this._isFocused ? this._captureFps : this._idleCaptureFps
    const interval = Math.round(1000 / fps)

    // Dynamically adjust timer
    if (this._captureTimer) {
      clearInterval(this._captureTimer)
      this._captureTimer = setInterval(() => {
        this._tick().catch(() => {})
      }, interval)
    }

    try {
      const frame = await this._controller.captureScreenshot("jpeg", 70)
      if (frame && !this._destroyed) {
        this._drawFrame(frame)
        this.requestRender()
      }
    } catch {
      // Webview may not be ready yet, silently ignore
    }
  }

  // ==========================================================================
  // Frame Drawing
  // ==========================================================================

  private _drawFrame(frame: RgbaBuffer): void {
    if (!frame.data || frame.width === 0 || frame.height === 0) return

    const targetW = this._pixelWidth || this.width * 2
    const targetH = this._pixelHeight || this.height * 4

    let pixels = frame.data
    let width = frame.width
    let height = frame.height

    if (width !== targetW || height !== targetH) {
      const resized = this._resizeFrame(pixels, width, height, targetW, targetH)
      if (resized) {
        pixels = resized.data
        width = resized.width
        height = resized.height
      }
    }

    const alignedBytesPerRow = computeAlignedBytesPerRow(width)
    this.frameBuffer.drawSuperSampleBuffer(
      0,
      0,
      pixels as unknown as any,
      pixels.byteLength,
      "rgba8unorm",
      alignedBytesPerRow,
    )
  }

  private _resizeFrame(
    pixels: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
  ): RgbaBuffer | null {
    if (dstW === 0 || dstH === 0) return null

    const result = new Uint8ClampedArray(dstW * dstH * BYTES_PER_PIXEL)
    const xRatio = srcW / dstW
    const yRatio = srcH / dstH

    for (let y = 0; y < dstH; y++) {
      const srcY = Math.min(Math.floor(y * yRatio), srcH - 1)
      for (let x = 0; x < dstW; x++) {
        const srcX = Math.min(Math.floor(x * xRatio), srcW - 1)
        const srcIdx = (srcY * srcW + srcX) * BYTES_PER_PIXEL
        const dstIdx = (y * dstW + x) * BYTES_PER_PIXEL
        result[dstIdx] = pixels[srcIdx] ?? 0
        result[dstIdx + 1] = pixels[srcIdx + 1] ?? 0
        result[dstIdx + 2] = pixels[srcIdx + 2] ?? 0
        result[dstIdx + 3] = pixels[srcIdx + 3] ?? 255
      }
    }

    return { data: result, width: dstW, height: dstH }
  }

  // ==========================================================================
  // Mouse Handlers
  // ==========================================================================

  private _handleMouseDown(event: MouseEvent): void {
    const sessionId = this._controller.getSessionId()
    if (!sessionId) return
    const x = this._cellToPixelX(event.x)
    const y = this._cellToPixelY(event.y)
    mouseDown(sessionId, x, y, event.button)
  }

  private _handleMouseUp(event: MouseEvent): void {
    const sessionId = this._controller.getSessionId()
    if (!sessionId) return
    const x = this._cellToPixelX(event.x)
    const y = this._cellToPixelY(event.y)
    mouseUp(sessionId, x, y, event.button)
  }

  private _handleMouseMove(event: MouseEvent): void {
    const sessionId = this._controller.getSessionId()
    if (!sessionId) return
    const x = this._cellToPixelX(event.x)
    const y = this._cellToPixelY(event.y)
    mouseMove(sessionId, x, y)
  }

  private _handleMouseScroll(event: MouseEvent): void {
    const sessionId = this._controller.getSessionId()
    if (!sessionId) return
    const x = this._cellToPixelX(event.x)
    const y = this._cellToPixelY(event.y)
    const delta = event.scroll?.delta ?? 3
    const direction = event.scroll?.direction ?? "down"
    const dy = direction === "up" ? -delta : direction === "down" ? delta : 0
    const dx = direction === "left" ? -delta : direction === "right" ? delta : 0
    mouseWheel(sessionId, x, y, dx, dy)
  }

  // ==========================================================================
  // Coordinate Conversion
  // ==========================================================================

  private _cellToPixelX(cellX: number): number {
    const resolution = this._resolution
    if (!resolution) return cellX * 8
    const cellWidth = resolution.width / (this._ctx as any).terminalWidth
    return Math.floor((cellX - this.x) * cellWidth)
  }

  private _cellToPixelY(cellY: number): number {
    const resolution = this._resolution
    if (!resolution) return cellY * 16
    const cellHeight = resolution.height / (this._ctx as any).terminalHeight
    return Math.floor((cellY - this.y) * cellHeight)
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  async loadUrl(url: string): Promise<void> {
    this._url = url
    await this._controller.goto(url)
  }

  async loadHtml(html: string): Promise<void> {
    const sessionId = this._controller.getSessionId()
    if (sessionId) {
      const { setHtml } = await import("./native-bridge")
      setHtml(sessionId, html)
    }
  }

  override focus(): void {
    this._isFocused = true
  }

  override blur(): void {
    this._isFocused = false
  }

  get url(): string {
    return this._controller.getState().url
  }

  get title(): string {
    return this._controller.getState().title
  }

  get loading(): boolean {
    return this._controller.getState().loading
  }

  get error(): string | null {
    return this._controller.getState().error
  }
}
