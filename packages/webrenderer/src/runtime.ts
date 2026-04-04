import {
  createWebview,
  navigate as nativeNavigate,
  setHtml as nativeSetHtml,
  evalJs,
  resizeWebview,
  destroyWebview,
  destroyRuntime,
  captureScreenshot,
  mouseDown as nativeMouseDown,
  mouseUp as nativeMouseUp,
  mouseMove as nativeMouseMove,
  mouseWheel as nativeMouseWheel,
  keyDown as nativeKeyDown,
  insertText as nativeInsertText,
  type RgbaBuffer,
} from "./native-bridge"

// ============================================================================
// Types
// ============================================================================

export interface WebViewState {
  url: string
  title: string
  loading: boolean
  error: string | null
  canGoBack: boolean
  canGoForward: boolean
  ready: boolean
}

export interface BrowserSessionConfig {
  url: string
  viewportWidth: number
  viewportHeight: number
  onStateChange?: (state: WebViewState) => void
}

export interface BrowserSession {
  id: number
  url: string
  title: string
  loading: boolean
  ready: boolean
  error: string | null
  canGoBack: boolean
  canGoForward: boolean
  destroy(): void
  goto(url: string): Promise<void>
  reload(): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  resize(width: number, height: number): void
  captureScreenshot(format?: "png" | "jpeg", quality?: number): Promise<RgbaBuffer | null>
  evaluateExpression(expression: string): Promise<void>
  setViewportSize(width: number, height: number): void
}

// ============================================================================
// BrowserRuntime — singleton managing native webview lifecycle
// ============================================================================

let _instance: BrowserRuntime | null = null

export class BrowserRuntime {
  private _sessions: Map<number, BrowserSession> = new Map()
  private _nextId = 0

  static getDefault(): BrowserRuntime {
    if (!_instance) {
      _instance = new BrowserRuntime()
    }
    return _instance
  }

  async createSession(config: BrowserSessionConfig): Promise<BrowserSession> {
    const session = new NativeBrowserSession(
      this,
      config.url,
      config.viewportWidth,
      config.viewportHeight,
      config.onStateChange,
    )
    this._sessions.set(session.id, session)
    return session
  }

  removeSession(id: number): void {
    this._sessions.delete(id)
  }

  async destroy(): Promise<void> {
    for (const session of this._sessions.values()) {
      session.destroy()
    }
    this._sessions.clear()
    destroyRuntime()
  }
}

// ============================================================================
// NativeBrowserSession — wraps a native webview instance
// ============================================================================

class NativeBrowserSession implements BrowserSession {
  id: number
  url: string
  title: string = ""
  loading: boolean = false
  ready: boolean = false
  error: string | null = null
  canGoBack: boolean = false
  canGoForward: boolean = false

  private _runtime: BrowserRuntime
  private _viewportWidth: number
  private _viewportHeight: number
  private _onStateChange?: (state: WebViewState) => void
  private _history: string[] = []
  private _historyIndex: number = -1

  constructor(
    runtime: BrowserRuntime,
    url: string,
    viewportWidth: number,
    viewportHeight: number,
    onStateChange?: (state: WebViewState) => void,
  ) {
    this._runtime = runtime
    this.url = url
    this._viewportWidth = viewportWidth
    this._viewportHeight = viewportHeight
    this._onStateChange = onStateChange

    // Create the native webview
    this.id = createWebview(url, viewportWidth, viewportHeight)
    this.loading = !!url
    this.ready = false

    // Track initial URL in history
    if (url) {
      this._history.push(url)
      this._historyIndex = 0
    }

    // Emit initial state
    this._emitState()
  }

  private _emitState(): void {
    this._onStateChange?.({
      url: this.url,
      title: this.title,
      loading: this.loading,
      error: this.error,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      ready: this.ready,
    })
  }

  private _updateNavState(): void {
    this.canGoBack = this._historyIndex > 0
    this.canGoForward = this._historyIndex < this._history.length - 1
  }

  async goto(url: string): Promise<void> {
    this.url = url
    this.loading = true
    this.error = null
    this._emitState()

    // Push to history
    if (this._historyIndex < this._history.length - 1) {
      this._history = this._history.slice(0, this._historyIndex + 1)
    }
    this._history.push(url)
    this._historyIndex = this._history.length - 1
    this._updateNavState()

    nativeNavigate(this.id, url)

    // Mark as ready after a short delay (native webview loads async)
    setTimeout(() => {
      this.loading = false
      this.ready = true
      this._emitState()
    }, 500)
  }

  async reload(): Promise<void> {
    if (this.url) {
      this.loading = true
      this._emitState()
      nativeNavigate(this.id, this.url)
      setTimeout(() => {
        this.loading = false
        this._emitState()
      }, 500)
    }
  }

  async back(): Promise<void> {
    if (this._historyIndex > 0) {
      this._historyIndex--
      const url = this._history[this._historyIndex]!
      this.url = url
      this.loading = true
      this._updateNavState()
      this._emitState()
      nativeNavigate(this.id, url)
      setTimeout(() => {
        this.loading = false
        this._emitState()
      }, 500)
    }
  }

  async forward(): Promise<void> {
    if (this._historyIndex < this._history.length - 1) {
      this._historyIndex++
      const url = this._history[this._historyIndex]!
      this.url = url
      this.loading = true
      this._updateNavState()
      this._emitState()
      nativeNavigate(this.id, url)
      setTimeout(() => {
        this.loading = false
        this._emitState()
      }, 500)
    }
  }

  resize(width: number, height: number): void {
    this._viewportWidth = width
    this._viewportHeight = height
    resizeWebview(this.id, width, height)
  }

  setViewportSize(width: number, height: number): void {
    this.resize(width, height)
  }

  async captureScreenshot(format: "png" | "jpeg" = "jpeg", quality = 80): Promise<RgbaBuffer | null> {
    return captureScreenshot(this.id, format, quality)
  }

  async evaluateExpression(expression: string): Promise<void> {
    evalJs(this.id, expression)
  }

  destroy(): void {
    destroyWebview(this.id)
    this._runtime.removeSession(this.id)
  }
}

// ============================================================================
// WebViewController — state bridge for SolidJS components
// ============================================================================

export type WebViewStateListener = (state: WebViewState) => void

export class WebViewController {
  private _state: WebViewState
  private _listeners: Set<WebViewStateListener> = new Set()
  private _session: BrowserSession | null = null
  private _runtime: BrowserRuntime

  constructor() {
    this._state = {
      url: "",
      title: "",
      loading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
      ready: false,
    }
    this._runtime = BrowserRuntime.getDefault()
  }

  getState(): WebViewState {
    return { ...this._state }
  }

  subscribe(listener: WebViewStateListener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  private _notify(): void {
    const state = this.getState()
    for (const listener of this._listeners) {
      listener(state)
    }
  }

  async init(url: string, viewportWidth: number, viewportHeight: number): Promise<void> {
    if (this._session) {
      await this._session.goto(url)
      return
    }

    this._state.loading = true
    this._notify()

    this._session = await this._runtime.createSession({
      url,
      viewportWidth,
      viewportHeight,
      onStateChange: (state) => {
        this._state = { ...state }
        this._notify()
      },
    })
  }

  async goto(url: string): Promise<void> {
    if (!this._session) {
      await this.init(url, 800, 600)
      return
    }
    await this._session.goto(url)
  }

  async reload(): Promise<void> {
    if (this._session) {
      await this._session.reload()
    }
  }

  async back(): Promise<void> {
    if (this._session) {
      await this._session.back()
    }
  }

  async forward(): Promise<void> {
    if (this._session) {
      await this._session.forward()
    }
  }

  focus(): void {
    // Native webview focuses automatically when interacted with
  }

  resize(width: number, height: number): void {
    if (this._session) {
      this._session.resize(width, height)
    }
  }

  async captureScreenshot(format?: "png" | "jpeg", quality?: number): Promise<RgbaBuffer | null> {
    if (!this._session) return null
    return this._session.captureScreenshot(format, quality)
  }

  async evaluateExpression(expression: string): Promise<void> {
    if (this._session) {
      await this._session.evaluateExpression(expression)
    }
  }

  destroy(): void {
    if (this._session) {
      this._session.destroy()
      this._session = null
    }
    this._listeners.clear()
  }

  getSessionId(): number | null {
    return this._session?.id ?? null
  }
}

export function createWebViewController(): WebViewController {
  return new WebViewController()
}

export function normalizeWebUrl(rawUrl: string): string {
  if (!rawUrl) return ""
  const trimmed = rawUrl.trim()
  if (!trimmed) return ""
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^file:\/\//i.test(trimmed)) return trimmed
  if (/^about:/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}
