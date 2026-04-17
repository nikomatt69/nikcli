import { CdpClient } from "./client"
import { launchChromiumSession } from "./launcher"
import type {
  BrowserEngineAdapter,
  BrowserFrame,
  BrowserKeyboardEvent,
  BrowserMouseEvent,
  BrowserState,
  BrowserViewport,
} from "../../types"

type ChromiumSessionHandle = Awaited<ReturnType<typeof launchChromiumSession>>

const SPECIAL_KEYS: Record<
  string,
  { key: string; code: string; keyCode: number; text?: string }
> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9, text: "\t" },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
}

function buttonName(button?: string) {
  switch (button) {
    case "middle":
      return "middle"
    case "right":
      return "right"
    default:
      return "left"
  }
}

function modifierMask(event: BrowserKeyboardEvent) {
  let modifiers = 0
  if (event.alt) modifiers |= 1
  if (event.ctrl) modifiers |= 2
  if (event.meta) modifiers |= 4
  if (event.shift) modifiers |= 8
  return modifiers
}

export class ChromiumCdpBrowserEngine implements BrowserEngineAdapter {
  private viewport: BrowserViewport
  private browserPath?: string
  private launchHandle: ChromiumSessionHandle | null = null
  private client: CdpClient | null = null
  private listeners = new Set<(state: BrowserState) => void>()
  private frameListener: ((frame: BrowserFrame) => void) | null = null
  private screenshotTimer: ReturnType<typeof setInterval> | null = null
  private screencastFrameCount = 0
  private state: BrowserState = {
    url: "",
    title: "",
    loading: false,
    error: null,
    canGoBack: false,
    canGoForward: false,
    ready: false,
  }

  constructor(viewport: BrowserViewport, browserPath?: string) {
    this.viewport = viewport
    this.browserPath = browserPath
  }

  getState() {
    return { ...this.state }
  }

  subscribe(listener: (state: BrowserState) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emitState(patch: Partial<BrowserState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.getState())
  }

  private getClient() {
    if (!this.client) throw new Error("Chromium CDP client not started")
    return this.client
  }

  private async refreshNavigationState() {
    const history = await this.getClient().send<{
      currentIndex: number
      entries: Array<{ id: number; url: string; title: string }>
    }>("Page.getNavigationHistory")

    const current = history.entries[history.currentIndex]
    this.emitState({
      url: current?.url ?? this.state.url,
      title: current?.title ?? this.state.title,
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
    })
  }

  private bindEvents(client: CdpClient) {
    client.on("Page.frameNavigated", (params) => {
      if (params?.frame?.parentId) return
      this.emitState({ url: params?.frame?.url ?? this.state.url })
    })

    client.on("Page.navigatedWithinDocument", (params) => {
      if (params?.url) this.emitState({ url: params.url })
    })

    client.on("Page.loadEventFired", async () => {
      this.emitState({ loading: false, ready: true })
      await this.refreshNavigationState().catch(() => {})
    })

    client.on("Page.screencastFrame", async (params) => {
      this.screencastFrameCount += 1
      const format = params?.metadata?.format === "png" ? "png" : "jpeg"
      if (this.frameListener && params?.data) {
        this.frameListener({
          format,
          data: Uint8Array.from(Buffer.from(params.data, "base64")),
          timestamp: Date.now(),
        })
      }
      await client.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {})
    })

    client.on("Network.loadingFailed", (params) => {
      if (params?.type !== "Document" || params?.canceled) return
      this.emitState({ loading: false, error: params.errorText ?? "Navigation failed" })
    })

    client.on("Inspector.targetCrashed", () => {
      this.emitState({ loading: false, error: "Chromium target crashed" })
    })

    client.onClose(() => {
      this.emitState({ loading: false, ready: false, error: "Chromium connection closed" })
    })
  }

  async start() {
    if (this.client) return
    this.launchHandle = await launchChromiumSession(this.browserPath)
    this.client = await CdpClient.connect(this.launchHandle.webSocketDebuggerUrl)
    this.bindEvents(this.client)

    await this.client.send("Page.enable")
    await this.client.send("Network.enable")
    await this.client.send("Runtime.enable")
    await this.client.send("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => {})
    await this.setViewport(this.viewport)
    await this.refreshNavigationState().catch(() => {})
    this.emitState({ ready: true, error: null })
  }

  async goto(url: string) {
    this.emitState({ loading: true, error: null, url })
    await this.getClient().send("Page.navigate", { url })
  }

  async back() {
    const history = await this.getClient().send<{
      currentIndex: number
      entries: Array<{ id: number }>
    }>("Page.getNavigationHistory")
    const entry = history.entries[history.currentIndex - 1]
    if (!entry) return
    this.emitState({ loading: true, error: null })
    await this.getClient().send("Page.navigateToHistoryEntry", { entryId: entry.id })
    await this.refreshNavigationState().catch(() => {})
  }

  async forward() {
    const history = await this.getClient().send<{
      currentIndex: number
      entries: Array<{ id: number }>
    }>("Page.getNavigationHistory")
    const entry = history.entries[history.currentIndex + 1]
    if (!entry) return
    this.emitState({ loading: true, error: null })
    await this.getClient().send("Page.navigateToHistoryEntry", { entryId: entry.id })
    await this.refreshNavigationState().catch(() => {})
  }

  async reload() {
    this.emitState({ loading: true, error: null })
    await this.getClient().send("Page.reload", { ignoreCache: false })
  }

  async setViewport(viewport: BrowserViewport) {
    this.viewport = viewport
    await this.getClient().send("Emulation.setDeviceMetricsOverride", {
      width: viewport.pixelWidth,
      height: viewport.pixelHeight,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: viewport.pixelWidth,
      screenHeight: viewport.pixelHeight,
    })

    if (this.frameListener) {
      await this.getClient()
        .send("Page.startScreencast", {
          format: "jpeg",
          quality: 65,
          everyNthFrame: 1,
          maxWidth: viewport.pixelWidth,
          maxHeight: viewport.pixelHeight,
        })
        .catch(() => {})
    }
  }

  async sendMouse(event: BrowserMouseEvent & { pixelX: number; pixelY: number }) {
    if (event.type === "scroll") {
      await this.getClient().send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: event.pixelX,
        y: event.pixelY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        pointerType: "mouse",
      })
      return
    }

    await this.getClient().send("Input.dispatchMouseEvent", {
      type:
        event.type === "down" ? "mousePressed" : event.type === "up" ? "mouseReleased" : "mouseMoved",
      x: event.pixelX,
      y: event.pixelY,
      button: buttonName(event.button),
      clickCount: event.type === "move" ? 0 : 1,
      pointerType: "mouse",
    })
  }

  async sendKeyboard(event: BrowserKeyboardEvent) {
    const key = event.key.toLowerCase()
    const modifiers = modifierMask(event)

    if (event.text && event.text.length === 1 && !event.ctrl && !event.meta && !event.alt) {
      await this.getClient().send("Input.insertText", { text: event.text })
      return
    }

    const special = SPECIAL_KEYS[key]
    const keyInfo = special ?? {
      key: event.key,
      code: event.key.length === 1 ? `Key${event.key.toUpperCase()}` : event.key,
      keyCode: event.key.toUpperCase().charCodeAt(0),
      text: event.text,
    }

    await this.getClient().send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
      text: keyInfo.text,
      unmodifiedText: keyInfo.text,
      modifiers,
    })
    await this.getClient().send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
      modifiers,
    })
  }

  private startScreenshotFallback() {
    if (this.screenshotTimer) return
    this.screenshotTimer = setInterval(async () => {
      if (!this.frameListener) return
      try {
        const result = await this.getClient().send<{ data: string }>("Page.captureScreenshot", {
          format: "jpeg",
          quality: 65,
          fromSurface: true,
        })
        this.frameListener({
          format: "jpeg",
          data: Uint8Array.from(Buffer.from(result.data, "base64")),
          timestamp: Date.now(),
        })
      } catch {}
    }, 350)
  }

  async captureFrames(onFrame: (frame: BrowserFrame) => void) {
    this.frameListener = onFrame
    this.screencastFrameCount = 0

    try {
      await this.getClient().send("Page.startScreencast", {
        format: "jpeg",
        quality: 65,
        everyNthFrame: 1,
        maxWidth: this.viewport.pixelWidth,
        maxHeight: this.viewport.pixelHeight,
      })
      setTimeout(() => {
        if (this.screencastFrameCount === 0) this.startScreenshotFallback()
      }, 1500)
    } catch {
      this.startScreenshotFallback()
    }
  }

  async dispose() {
    if (this.screenshotTimer) {
      clearInterval(this.screenshotTimer)
      this.screenshotTimer = null
    }

    try {
      await this.client?.send("Page.stopScreencast")
    } catch {}
    this.client?.close()
    this.client = null

    if (this.launchHandle) {
      await this.launchHandle.dispose()
      this.launchHandle = null
    }
  }
}
