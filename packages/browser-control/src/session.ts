/**
 * BrowserSession — a single headless page whose state can be inspected,
 * driven and captured. Each session is its own Bun.WebView (WebKit on macOS,
 * Chrome-family elsewhere). Views share one host process per Bun process.
 */
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWebView, type WebViewInstance, type WebViewModifier } from "@nikcli-ai/util/bun-utils"
import type { BrowserFrame, ConsoleEntry, Viewport } from "./frame"
import { parseKeyChord } from "./keys"
import { Recorder, type RecordingData, type RecordingMarker, type StartRecordingOptions } from "./recording"
import { exportVideoFromFrames } from "./render/video"
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
  /** Sample screenshots for a video assembled on {@link BrowserSession.stop}. */
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

export interface KeyInput {
  readonly key?: string
  readonly text?: string
}

const MODIFIER_WEB: Record<PointerModifier, WebViewModifier> = {
  alt: "Alt",
  control: "Control",
  meta: "Meta",
  shift: "Shift",
}

const ARIA_SNAPSHOT = `(() => {
  const ROLE = {
    a: "link", button: "button", textarea: "textbox", select: "combobox",
    img: "img", nav: "navigation", main: "main", header: "banner",
    footer: "contentinfo", dialog: "dialog", h1: "heading", h2: "heading",
    h3: "heading", h4: "heading", h5: "heading", h6: "heading",
    li: "listitem", ul: "list", ol: "list", table: "table",
  };
  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "submit" || t === "button") return "button";
      if (t === "hidden") return null;
      return "textbox";
    }
    return ROLE[tag] || null;
  }
  function nameOf(el) {
    const raw = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || (typeof el.value === "string" ? el.value : "") || (el.innerText || "");
    return String(raw).trim().replace(/\\s+/g, " ").slice(0, 80);
  }
  function walk(el, depth) {
    if (!el || el.nodeType !== 1) return "";
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return "";
    const role = roleOf(el);
    let out = "";
    let next = depth;
    if (role) {
      const name = nameOf(el);
      out += "  ".repeat(depth) + role + (name ? ': "' + name.replace(/"/g, '\\\\"') + '"' : "") + "\\n";
      next = depth + 1;
    }
    for (const child of el.children) out += walk(child, next);
    return out;
  }
  return walk(document.body, 0).trimEnd();
})()`

export class BrowserSession {
  readonly name: string

  private readonly view: WebViewInstance
  private readonly createdAt = Date.now()
  private status: SessionStatus = "running"
  private lastUsed = Date.now()
  private viewport: Viewport
  private consoleLog: ConsoleEntry[] = []
  private recorder: Recorder | null = null
  private screencast: Screencast | null = null
  private assembledVideo: string | undefined
  private recordOnStop: boolean
  private tail: Promise<unknown> = Promise.resolve()

  static async create(options: SessionOptions): Promise<BrowserSession> {
    const viewport = options.viewport ?? { width: 1280, height: 800 }
    const session = new BrowserSession(options.name, viewport, Boolean(options.record))
    if (options.url) await session.goto(options.url)
    if (options.userAgent) await session.applyUserAgent(options.userAgent)
    if (options.record) await session.startRecording({ sampleFps: 8 })
    return session
  }

  private constructor(name: string, viewport: Viewport, recordOnStop: boolean) {
    this.name = name
    this.viewport = viewport
    this.recordOnStop = recordOnStop
    this.view = createWebView({
      width: viewport.width,
      height: viewport.height,
      console: (type, ...args) => {
        const text = args.map((arg) => (typeof arg === "string" ? arg : stringifyConsole(arg))).join(" ")
        this.consoleLog.push({ time: Date.now(), type, text })
        if (this.consoleLog.length > CONSOLE_LOG_LIMIT) this.consoleLog = this.consoleLog.slice(-CONSOLE_LOG_LIMIT)
      },
    })
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async applyUserAgent(userAgent: string): Promise<void> {
    await this.run(async () => {
      try {
        await this.view.cdp("Emulation.setUserAgentOverride", { userAgent })
      } catch {
        await this.view.evaluate(
          `Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => ${JSON.stringify(userAgent)} })`,
        )
      }
    })
  }

  info(): SessionInfo {
    return {
      name: this.name,
      url: this.status === "running" ? this.view.url : "",
      viewport: this.viewport,
      status: this.status,
      createdAt: this.createdAt,
      recording: this.isRecording(),
    }
  }

  isRunning(): boolean {
    return this.status === "running"
  }

  /** When this session was last driven. See {@link SessionManager.reapIdle}. */
  get lastUsedAt(): number {
    return this.lastUsed
  }

  /** Mark the session as used right now. Called for every operation on it. */
  touch(): void {
    this.lastUsed = Date.now()
  }

  /**
   * Doing something on its own, with nobody driving it: a live view is
   * streaming frames, or a recording is sampling them. Neither shows up as an
   * operation, and both are reasons not to reap the session.
   */
  isBusy(): boolean {
    return this.isScreencasting() || this.isRecording()
  }

  async goto(url: string): Promise<void> {
    this.assertRunning()
    await this.run(() => this.view.navigate(url))
  }

  async send(input: string, mode: SendMode = "text"): Promise<void> {
    this.assertRunning()
    if (mode === "text") {
      await this.run(() => this.view.type(input))
      return
    }
    for (const token of input.split(/\s+/).filter(Boolean)) {
      const { key, modifiers } = parseKeyChord(token)
      await this.run(() => this.view.press(key, modifiers.length > 0 ? { modifiers } : undefined))
    }
  }

  async back(): Promise<boolean> {
    this.assertRunning()
    return this.run(async () => {
      const before = this.view.url
      await this.view.goBack()
      return this.view.url !== before
    })
  }

  async forward(): Promise<boolean> {
    this.assertRunning()
    return this.run(async () => {
      const before = this.view.url
      await this.view.goForward()
      return this.view.url !== before
    })
  }

  async reload(): Promise<void> {
    this.assertRunning()
    await this.run(() => this.view.reload())
  }

  async click(selector: string): Promise<void> {
    this.assertRunning()
    await this.run(() => this.view.click(selector))
  }

  async pointer(input: PointerInput): Promise<void> {
    this.assertRunning()
    const modifiers = (input.modifiers ?? []).map((item) => MODIFIER_WEB[item])
    const button = input.button ?? "left"
    const clickCount = (input.clickCount === 2 || input.clickCount === 3 ? input.clickCount : 1) as 1 | 2 | 3
    await this.run(async () => {
      switch (input.type) {
        case "click":
          await this.view.click(input.x, input.y, { button, clickCount, modifiers })
          return
        case "wheel":
          await this.view.scroll(input.deltaX ?? 0, input.deltaY ?? 0)
          return
        default:
          await this.view.evaluate(pointerScript(input.type, input.x, input.y, button, clickCount))
      }
    })
  }

  async key(input: KeyInput): Promise<void> {
    this.assertRunning()
    if (input.text !== undefined && input.text.length > 0) {
      await this.run(() => this.view.type(input.text!))
      return
    }
    if (input.key !== undefined && input.key.length > 0) {
      const { key, modifiers } = parseKeyChord(input.key)
      await this.run(() => this.view.press(key, modifiers.length > 0 ? { modifiers } : undefined))
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    this.assertRunning()
    const sel = JSON.stringify(selector)
    const val = JSON.stringify(value)
    await this.run(async () => {
      await this.view.click(selector)
      await this.view.evaluate(
        `(() => { const el = document.querySelector(${sel}); if (!el) throw new Error("not found"); if ("value" in el) { el.focus(); if (typeof el.select === "function") el.select(); el.value = ${val}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } else { el.textContent = ${val}; } return true })()`,
      )
    })
  }

  async hover(selector: string): Promise<void> {
    this.assertRunning()
    const sel = JSON.stringify(selector)
    await this.run(() =>
      this.view.evaluate(
        `(() => { const el = document.querySelector(${sel}); if (!el) throw new Error("not found"); el.scrollIntoView({ block: "center", behavior: "instant" }); const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter"]) el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y })); return true })()`,
      ),
    )
  }

  async scroll(dx: number, dy: number): Promise<void> {
    this.assertRunning()
    await this.run(() => this.view.scroll(dx, dy))
  }

  async resize(width: number, height: number): Promise<SessionInfo> {
    this.assertRunning()
    await this.run(() => this.view.resize(width, height))
    this.viewport = { width, height }
    return this.info()
  }

  async snapshot(): Promise<BrowserFrame> {
    this.assertRunning()
    return this.run(async () => {
      const screenshot = await screenshotPng(this.view)
      const text = String((await this.view.evaluate(ARIA_SNAPSHOT).catch(() => "")) ?? "")
      return {
        url: this.view.url,
        title: this.view.title,
        viewport: this.viewport,
        screenshot,
        text,
        console: this.consoleLog.slice(-CONSOLE_LOG_LIMIT),
      }
    })
  }

  async text(): Promise<string> {
    const frame = await this.snapshot()
    return frame.text
  }

  async startScreencast(options: ScreencastOptions = {}): Promise<Screencast> {
    this.assertRunning()
    await this.stopScreencast()
    const screencast = Screencast.start(() => this.capturePng(), this.viewport, options)
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

  async wait(condition: WaitCondition): Promise<WaitResult> {
    this.assertRunning()

    if (condition.type === "timeout") {
      await delay(condition.ms)
      return { satisfied: true, reason: "timeout", frame: await this.snapshot() }
    }

    if (condition.type === "selector") {
      const satisfied = await this.waitSelector(
        condition.value,
        condition.state ?? "visible",
        condition.timeout ?? 10_000,
      )
      return { satisfied, reason: satisfied ? "matched" : "timeout", frame: await this.snapshot() }
    }

    if (condition.type === "idle") {
      const satisfied = await this.waitIdle(condition.timeout ?? 10_000)
      return { satisfied, reason: satisfied ? "idle" : "timeout", frame: await this.snapshot() }
    }

    if (condition.type === "stable") {
      const satisfied = await this.waitStable(condition.ms ?? 500, condition.timeout ?? 10_000)
      return { satisfied, reason: satisfied ? "stable" : "timeout", frame: await this.snapshot() }
    }

    const satisfied = await this.waitText(condition.value, condition.timeout ?? 10_000)
    return { satisfied, reason: satisfied ? "matched" : "timeout", frame: await this.snapshot() }
  }

  private async waitSelector(selector: string, state: string, timeoutMs: number): Promise<boolean> {
    const sel = JSON.stringify(selector)
    const want = JSON.stringify(state)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ok = await this.run(() =>
        this.view.evaluate(
          `(() => { const el = document.querySelector(${sel}); const state = ${want}; if (state === "attached") return !!el; if (state === "detached") return !el; if (!el) return false; const style = getComputedStyle(el); const r = el.getBoundingClientRect(); const visible = style.visibility !== "hidden" && style.display !== "none" && r.width > 0 && r.height > 0; return state === "visible" ? visible : !visible; })()`,
        ),
      ).catch(() => false)
      if (ok) return true
      await delay(50)
    }
    return false
  }

  private async waitIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ready = await this.run(async () => {
        if (this.view.loading) return false
        return this.view.evaluate(`document.readyState === "complete"`)
      }).catch(() => false)
      if (ready) {
        await delay(150)
        return true
      }
      await delay(50)
    }
    return false
  }

  private async waitText(needle: string, timeoutMs: number): Promise<boolean> {
    const value = JSON.stringify(needle)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ok = await this.run(() =>
        this.view.evaluate(`document.body ? document.body.innerText.includes(${value}) : false`),
      ).catch(() => false)
      if (ok) return true
      await delay(50)
    }
    return false
  }

  private async waitStable(quietMs: number, timeoutMs: number): Promise<boolean> {
    await this.run(() =>
      this.view.evaluate(`(() => {
        const w = window;
        w.__browserControlLastMutation = Date.now();
        if (!w.__browserControlObserver) {
          w.__browserControlObserver = new MutationObserver(() => { w.__browserControlLastMutation = Date.now(); });
          w.__browserControlObserver.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
        }
        return true;
      })()`),
    )
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const quietFor = Number(
        await this.run(() =>
          this.view.evaluate(`Date.now() - (window.__browserControlLastMutation || Date.now())`),
        ).catch(() => 0),
      )
      if (quietFor >= quietMs) return true
      await delay(Math.min(50, Math.max(10, quietMs - quietFor)))
    }
    return false
  }

  async startRecording(options: StartRecordingOptions = {}): Promise<void> {
    this.assertRunning()
    this.recorder = new Recorder(
      (path) => this.writePng(path),
      () => this.view.url,
      this.viewport,
    )
    await this.recorder.start(options)
  }

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

  async videoPath(): Promise<string | undefined> {
    if (this.status === "running") return undefined
    return this.assembledVideo
  }

  async stop(): Promise<void> {
    if (this.status !== "running") return
    this.status = "closed"
    await this.stopScreencast().catch(() => {})
    const recording = this.recorder
    if (recording) {
      const data = await recording.stop().catch(() => null)
      this.recorder = null
      if (this.recordOnStop && data && data.samples.length > 0) {
        const dir = await mkdtemp(join(tmpdir(), "browser-control-video-"))
        const out = join(dir, "session.mp4")
        await exportVideoFromFrames(data.samples, { format: "mp4", outPath: out, fps: data.sampleFps }).catch(() => {})
        this.assembledVideo = out
      }
    }
    this.view.close()
  }

  private async capturePng(): Promise<Uint8Array> {
    return this.run(async () => screenshotPng(this.view))
  }

  private async writePng(path: string): Promise<boolean> {
    try {
      const png = await this.capturePng()
      await writeFile(path, png)
      return true
    } catch {
      return false
    }
  }

  private assertRunning(): void {
    if (this.status !== "running") throw new Error(`Browser session "${this.name}" is not running.`)
  }
}

function stringifyConsole(arg: unknown): string {
  if (arg === null || arg === undefined) return String(arg)
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg)
    } catch {
      return String(arg)
    }
  }
  return String(arg)
}

function pointerScript(
  type: "move" | "down" | "up",
  x: number,
  y: number,
  button: MouseButton,
  clickCount: number,
): string {
  const eventType = type === "move" ? "pointermove" : type === "down" ? "pointerdown" : "pointerup"
  const buttonCode = button === "middle" ? 1 : button === "right" ? 2 : 0
  const buttons = type === "up" ? 0 : buttonCode === 0 ? 1 : buttonCode
  return `(() => { const el = document.elementFromPoint(${x}, ${y}) || document.body; el.dispatchEvent(new PointerEvent(${JSON.stringify(eventType)}, { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, button: ${buttonCode}, buttons: ${buttons}, detail: ${clickCount} })); return true })()`
}

function screenshotPng(view: WebViewInstance): Promise<Buffer> {
  return view.screenshot({ encoding: "buffer" }).then((shot) => {
    if (Buffer.isBuffer(shot)) return shot
    if (shot instanceof Uint8Array) return Buffer.from(shot)
    throw new Error("WebView screenshot did not return PNG bytes")
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
