/**
 * BrowserSession — a single headless page whose state can be inspected,
 * driven and captured. Sessions share one background Chromium process (see
 * {@link SessionManager}) the way named tmux panes share one terminal
 * multiplexer; each session is its own isolated `BrowserContext` (cookies,
 * storage, viewport) with one `Page`.
 */
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Browser, BrowserContext, ConsoleMessage, Page } from "playwright"
import type { BrowserFrame, ConsoleEntry, Viewport } from "./frame"
import { translateKey, translateKeys } from "./keys"
import { Recorder, type RecordingData, type RecordingMarker, type StartRecordingOptions } from "./recording"
import { Screencast, type ScreencastOptions } from "./screencast"

const CONSOLE_LOG_LIMIT = 200

export type SessionStatus = "running" | "closed"

export interface SessionInfo {
  readonly name: string
  readonly url: string
  readonly viewport: Viewport
  readonly status: SessionStatus
  readonly createdAt: number
  readonly recording: boolean
}

export interface SessionOptions {
  readonly name: string
  readonly url?: string
  readonly viewport?: Viewport
  readonly userAgent?: string
  /** Capture a webm video of the whole session; only readable via {@link BrowserSession.videoPath} after `stop()`. */
  readonly record?: boolean
}

export type SendMode = "text" | "keys"

export type WaitCondition =
  | { readonly type: "text"; readonly value: string; readonly timeout?: number }
  | {
      readonly type: "selector"
      readonly value: string
      readonly state?: "attached" | "detached" | "visible" | "hidden"
      readonly timeout?: number
    }
  | { readonly type: "idle"; readonly timeout?: number }
  | { readonly type: "stable"; readonly ms?: number; readonly timeout?: number }
  | { readonly type: "timeout"; readonly ms: number }

export interface WaitResult {
  readonly satisfied: boolean
  readonly reason: "matched" | "idle" | "stable" | "timeout"
  readonly frame: BrowserFrame
}

export type MouseButton = "left" | "middle" | "right"

export type PointerModifier = "alt" | "control" | "meta" | "shift"

/**
 * A pointer event in *page pixels*. Selector-based {@link BrowserSession.click}
 * is what an agent wants ("click the submit button"); this is what a live view
 * needs, where the only thing known about the target is where the user pointed.
 */
export interface PointerInput {
  readonly type: "move" | "click" | "down" | "up" | "wheel"
  readonly x: number
  readonly y: number
  readonly button?: MouseButton
  readonly clickCount?: number
  readonly deltaX?: number
  readonly deltaY?: number
  readonly modifiers?: ReadonlyArray<PointerModifier>
}

/**
 * A keyboard event as a *terminal* can actually report one. Terminals emit
 * key presses, not down/up pairs, so modelling separate down and up events here
 * would be a fiction: `key` is a press (`enter`, `ctrl+a`, …) and `text` is
 * literal insertion (a printable character, or a paste).
 */
export interface KeyInput {
  readonly key?: string
  readonly text?: string
}

const MODIFIER_KEY: Record<PointerModifier, string> = {
  alt: "Alt",
  control: "Control",
  meta: "Meta",
  shift: "Shift",
}

export class BrowserSession {
  readonly name: string

  private readonly context: BrowserContext
  private readonly page: Page
  private readonly createdAt = Date.now()
  private status: SessionStatus = "running"
  private viewport: Viewport
  private consoleLog: ConsoleEntry[] = []
  private recorder: Recorder | null = null
  private videoDir: string | null = null
  private screencast: Screencast | null = null

  static async create(browser: Browser, options: SessionOptions): Promise<BrowserSession> {
    const viewport = options.viewport ?? { width: 1280, height: 800 }
    let videoDir: string | null = null
    if (options.record) videoDir = await mkdtemp(join(tmpdir(), "browser-control-video-"))

    const context = await browser.newContext({
      viewport,
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
    })
    const page = await context.newPage()
    const session = new BrowserSession(options.name, context, page, viewport, videoDir)

    page.on("console", (msg: ConsoleMessage) => {
      session.consoleLog.push({ time: Date.now(), type: msg.type(), text: msg.text() })
      if (session.consoleLog.length > CONSOLE_LOG_LIMIT)
        session.consoleLog = session.consoleLog.slice(-CONSOLE_LOG_LIMIT)
    })

    if (options.url) await page.goto(options.url, { waitUntil: "domcontentloaded" })
    return session
  }

  private constructor(name: string, context: BrowserContext, page: Page, viewport: Viewport, videoDir: string | null) {
    this.name = name
    this.context = context
    this.page = page
    this.viewport = viewport
    this.videoDir = videoDir
  }

  info(): SessionInfo {
    return {
      name: this.name,
      url: this.status === "running" ? this.page.url() : "",
      viewport: this.viewport,
      status: this.status,
      createdAt: this.createdAt,
      recording: this.isRecording(),
    }
  }

  isRunning(): boolean {
    return this.status === "running"
  }

  // --- Navigation & input -------------------------------------------------

  async goto(url: string): Promise<void> {
    this.assertRunning()
    await this.page.goto(url, { waitUntil: "domcontentloaded" })
  }

  /** Send input to the currently focused element. `text` types verbatim; `keys` translates key names. */
  async send(input: string, mode: SendMode = "text"): Promise<void> {
    this.assertRunning()
    if (mode === "text") {
      await this.page.keyboard.type(input)
      return
    }
    for (const key of translateKeys(input)) await this.page.keyboard.press(key)
  }

  /**
   * Walk back one entry in the page's own history. Resolves `false` at the
   * start of history.
   *
   * The return value is decided by comparing URLs, not by Playwright's — it
   * resolves `null` whenever the navigation produced no HTTP response, which
   * includes `data:` URLs and same-document history entries. Those *did*
   * navigate, and a back button that reports failure after moving is worse
   * than no back button.
   */
  async back(): Promise<boolean> {
    this.assertRunning()
    const before = this.page.url()
    await this.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {})
    return this.page.url() !== before
  }

  /** Walk forward one entry in the page's own history. Resolves `false` at the end of history. */
  async forward(): Promise<boolean> {
    this.assertRunning()
    const before = this.page.url()
    await this.page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {})
    return this.page.url() !== before
  }

  async reload(): Promise<void> {
    this.assertRunning()
    await this.page.reload({ waitUntil: "domcontentloaded" })
  }

  async click(selector: string): Promise<void> {
    this.assertRunning()
    await this.page.click(selector)
  }

  /** Dispatch a pointer event at page-pixel coordinates. See {@link PointerInput}. */
  async pointer(input: PointerInput): Promise<void> {
    this.assertRunning()
    const held = input.modifiers ?? []
    for (const modifier of held) await this.page.keyboard.down(MODIFIER_KEY[modifier])
    try {
      const button = input.button ?? "left"
      const clickCount = input.clickCount ?? 1
      switch (input.type) {
        case "move":
          await this.page.mouse.move(input.x, input.y)
          break
        case "click":
          await this.page.mouse.click(input.x, input.y, { button, clickCount })
          break
        case "down":
          await this.page.mouse.move(input.x, input.y)
          await this.page.mouse.down({ button, clickCount })
          break
        case "up":
          await this.page.mouse.move(input.x, input.y)
          await this.page.mouse.up({ button, clickCount })
          break
        case "wheel":
          await this.page.mouse.move(input.x, input.y)
          await this.page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 0)
          break
      }
    } finally {
      for (const modifier of [...held].reverse()) await this.page.keyboard.up(MODIFIER_KEY[modifier]).catch(() => {})
    }
  }

  /** Dispatch a single key press, or insert literal text. See {@link KeyInput}. */
  async key(input: KeyInput): Promise<void> {
    this.assertRunning()
    if (input.text !== undefined && input.text.length > 0) {
      await this.page.keyboard.insertText(input.text)
      return
    }
    if (input.key !== undefined && input.key.length > 0) {
      await this.page.keyboard.press(translateKey(input.key))
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    this.assertRunning()
    await this.page.fill(selector, value)
  }

  async hover(selector: string): Promise<void> {
    this.assertRunning()
    await this.page.hover(selector)
  }

  async scroll(dx: number, dy: number): Promise<void> {
    this.assertRunning()
    await this.page.mouse.wheel(dx, dy)
  }

  async resize(width: number, height: number): Promise<SessionInfo> {
    this.assertRunning()
    await this.page.setViewportSize({ width, height })
    this.viewport = { width, height }
    return this.info()
  }

  // --- Capture -------------------------------------------------------------

  async snapshot(): Promise<BrowserFrame> {
    this.assertRunning()
    const [screenshot, title, text] = await Promise.all([
      this.page.screenshot({ type: "png" }),
      this.page.title(),
      this.page.ariaSnapshot(),
    ])
    return {
      url: this.page.url(),
      title,
      viewport: this.viewport,
      screenshot,
      text,
      console: this.consoleLog.slice(-CONSOLE_LOG_LIMIT),
    }
  }

  async text(): Promise<string> {
    const frame = await this.snapshot()
    return frame.text
  }

  /**
   * Open a live PNG stream of the page (see {@link Screencast}). At most one
   * screencast runs per session; starting a second one replaces the first,
   * because the consumer is a single view and a page has one set of pixels.
   */
  async startScreencast(options: ScreencastOptions = {}): Promise<Screencast> {
    this.assertRunning()
    await this.stopScreencast()
    const screencast = await Screencast.start(this.context, this.page, options)
    this.screencast = screencast
    return screencast
  }

  async stopScreencast(): Promise<void> {
    const screencast = this.screencast
    if (!screencast) return
    this.screencast = null
    await screencast.stop()
  }

  isScreencasting(): boolean {
    return this.screencast !== null
  }

  rawConsole(lines?: number): ConsoleEntry[] {
    if (lines === undefined) return this.consoleLog.slice()
    return this.consoleLog.slice(-lines)
  }

  // --- Waiting ---------------------------------------------------------

  async wait(condition: WaitCondition): Promise<WaitResult> {
    this.assertRunning()

    if (condition.type === "timeout") {
      await delay(condition.ms)
      return { satisfied: true, reason: "timeout", frame: await this.snapshot() }
    }

    if (condition.type === "selector") {
      try {
        await this.page.waitForSelector(condition.value, {
          state: condition.state ?? "visible",
          timeout: condition.timeout ?? 10_000,
        })
        return { satisfied: true, reason: "matched", frame: await this.snapshot() }
      } catch {
        return { satisfied: false, reason: "timeout", frame: await this.snapshot() }
      }
    }

    if (condition.type === "idle") {
      try {
        await this.page.waitForLoadState("networkidle", { timeout: condition.timeout ?? 10_000 })
        return { satisfied: true, reason: "idle", frame: await this.snapshot() }
      } catch {
        return { satisfied: false, reason: "timeout", frame: await this.snapshot() }
      }
    }

    if (condition.type === "stable") {
      const quietMs = condition.ms ?? 500
      const timeout = condition.timeout ?? 10_000
      const satisfied = await this.waitStable(quietMs, timeout)
      return { satisfied, reason: satisfied ? "stable" : "timeout", frame: await this.snapshot() }
    }

    // text
    try {
      await this.page.waitForFunction(
        (needle: string) => document.body?.innerText.includes(needle) ?? false,
        condition.value,
        { timeout: condition.timeout ?? 10_000 },
      )
      return { satisfied: true, reason: "matched", frame: await this.snapshot() }
    } catch {
      return { satisfied: false, reason: "timeout", frame: await this.snapshot() }
    }
  }

  /**
   * Resolve once the DOM has had no mutations for `quietMs` — the browser
   * analog of terminal-control's "stable" (no new PTY output for N ms).
   * Installs a MutationObserver via `page.evaluate`; each call observes from
   * that point forward (a navigation tears down the JS context and the
   * observer with it, which is the correct behavior — "stable" after a fresh
   * navigation should measure quiet time on the new page, not the old one).
   */
  private async waitStable(quietMs: number, timeoutMs: number): Promise<boolean> {
    await this.page.evaluate(() => {
      const w = window as unknown as {
        __browserControlLastMutation?: number
        __browserControlObserver?: MutationObserver
      }
      w.__browserControlLastMutation = Date.now()
      if (!w.__browserControlObserver) {
        w.__browserControlObserver = new MutationObserver(() => {
          w.__browserControlLastMutation = Date.now()
        })
        w.__browserControlObserver.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        })
      }
    })

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const quietFor = await this.page
        .evaluate(
          () =>
            Date.now() - (window as unknown as { __browserControlLastMutation: number }).__browserControlLastMutation,
        )
        .catch(() => 0)
      if (quietFor >= quietMs) return true
      await delay(Math.min(50, Math.max(10, quietMs - quietFor)))
    }
    return false
  }

  // --- Recording --------------------------------------------------------

  /**
   * Begin recording: a Playwright trace (screenshots, DOM snapshots, network)
   * plus, if `sampleFps` is set, a periodic real-screenshot sequence usable
   * for {@link frameAt}/video export at any time — even before `stop()`.
   * Replaces any in-progress recording.
   */
  async startRecording(options: StartRecordingOptions = {}): Promise<void> {
    this.assertRunning()
    this.recorder = new Recorder(this.context, this.page, this.viewport)
    await this.recorder.start(options)
  }

  /** Add a named, screenshotted marker to the active recording. */
  marker(name: string): Promise<RecordingMarker | undefined> {
    return this.recorder ? this.recorder.marker(name) : Promise.resolve(undefined)
  }

  async stopRecording(): Promise<RecordingData | null> {
    if (!this.recorder) return null
    const data = await this.recorder.stop()
    this.recorder = null
    return data
  }

  recordingData(): RecordingData | null {
    return this.recorder ? this.recorder.data() : null
  }

  isRecording(): boolean {
    return this.recorder?.active ?? false
  }

  /**
   * Path to the session's webm video, if it was started with `record: true`.
   * Only resolvable after `stop()` — Playwright finalizes video files on
   * context close, not on demand.
   */
  async videoPath(): Promise<string | undefined> {
    if (this.status === "running") return undefined
    return (
      (await this.page
        .video()
        ?.path()
        .catch(() => undefined)) ?? undefined
    )
  }

  async stop(): Promise<void> {
    if (this.status !== "running") return
    this.status = "closed"
    await this.stopScreencast().catch(() => {})
    if (this.recorder) await this.recorder.stop().catch(() => {})
    await this.context.close().catch(() => {})
  }

  private assertRunning(): void {
    if (this.status !== "running") throw new Error(`Browser session "${this.name}" is not running.`)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
