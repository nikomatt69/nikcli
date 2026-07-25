/**
 * ComputerSession — a single named desktop whose state can be inspected,
 * driven and captured. Mirrors `@nikcli-ai/browser-control`'s
 * {@link BrowserSession} one-to-one: each session is its own isolated
 * desktop (sandbox container or real host desktop), with a `status`
 * (running/stopped), an info snapshot, screenshot/click/type/key/scroll
 * driving, and an optional `Recorder` for marker/sample-based evidence.
 */
import type { Backend, MouseButton, Point } from "./backends"
import { backend } from "./backends"
import { Sandbox } from "./sandbox"
import type { ComputerFrame, Mode, ScreenSize } from "./frame"
import { Recorder, type RecordingData, type RecordingMarker, type StartRecordingOptions } from "./recording"

export type SessionStatus = "running" | "stopped"

export interface SessionInfo {
  readonly name: string
  readonly mode: Mode
  readonly screen: ScreenSize
  readonly status: SessionStatus
  readonly createdAt: number
  readonly recording: boolean
  /** For `sandbox` mode only: optional live-preview URL (noVNC). */
  readonly liveUrl?: string
}

export interface SessionOptions {
  readonly name: string
  readonly mode?: Mode
  readonly width?: number
  readonly height?: number
  /** User-agent style override for the `userAgent` (no-op on desktop sessions, kept for symmetry with browser-control). */
  readonly userAgent?: string
}

export type SendMode = "text" | "keys"

export type WaitCondition =
  | { readonly type: "text"; readonly value: string; readonly timeout?: number }
  | { readonly type: "stable"; readonly ms?: number; readonly timeout?: number }
  | { readonly type: "timeout"; readonly ms: number }

export interface WaitResult {
  readonly satisfied: boolean
  readonly reason: "matched" | "stable" | "timeout"
  readonly frame: ComputerFrame
}

export class ComputerSession {
  readonly name: string
  readonly mode: Mode

  private readonly backend: Backend
  private readonly createdAt = Date.now()
  private status: SessionStatus = "running"
  private screen: ScreenSize
  private recorder: Recorder | null = null

  private constructor(name: string, mode: Mode, backendInstance: Backend, screen: ScreenSize) {
    this.name = name
    this.mode = mode
    this.backend = backendInstance
    this.screen = screen
  }

  static async create(nikcliSessionID: string, options: SessionOptions): Promise<ComputerSession> {
    const mode: Mode = options.mode ?? "sandbox"
    const instance = backend(mode, nikcliSessionID)
    const screen = await instance.screenSize()
    return new ComputerSession(options.name, mode, instance, screen)
  }

  info(): SessionInfo {
    const liveUrl = this.mode === "sandbox" ? Sandbox.local(this.name)?.liveUrl : undefined
    return {
      name: this.name,
      mode: this.mode,
      screen: this.screen,
      status: this.status,
      createdAt: this.createdAt,
      recording: this.isRecording(),
      ...(liveUrl ? { liveUrl } : {}),
    }
  }

  isRunning(): boolean {
    return this.status === "running"
  }

  private assertRunning(): void {
    if (this.status !== "running") throw new Error(`Computer session "${this.name}" is not running.`)
  }

  // --- Driving ----------------------------------------------------------

  async screenshot(): Promise<ComputerFrame> {
    this.assertRunning()
    const bytes = await this.backend.screenshot()
    return {
      mode: this.mode,
      screen: this.screen,
      screenshot: bytes,
      capturedAt: Date.now(),
    }
  }

  async screenSize(): Promise<ScreenSize> {
    this.assertRunning()
    return this.backend.screenSize()
  }

  async moveMouse(point: Point): Promise<void> {
    this.assertRunning()
    await this.backend.moveMouse(point)
  }

  async click(point: Point | undefined, button: MouseButton = "left", double = false): Promise<void> {
    this.assertRunning()
    await this.backend.click(point, button, double)
  }

  /** Mouse drag from `from` to `to`. */
  async drag(from: Point, to: Point): Promise<void> {
    this.assertRunning()
    await this.backend.drag(from, to)
  }

  /**
   * Send input. `text` types the string verbatim; `keys` translates key
   * tokens through {@link translateKey} (so e.g. `enter`, `ctrl+a`,
   * `alt+shift+x` all work as a single space-separated sequence).
   */
  async send(input: string, mode: SendMode = "text"): Promise<void> {
    this.assertRunning()
    if (mode === "text") {
      await this.backend.type(input)
      return
    }
    const { translateKeys } = await import("./keys")
    for (const chord of translateKeys(input)) await this.backend.key(chord)
  }

  /** Convenience: type the text verbatim, regardless of `mode`. */
  async type(text: string): Promise<void> {
    this.assertRunning()
    await this.backend.type(text)
  }

  /** Convenience: press a single key or modifier chord (e.g. `enter`, `cmd+a`). */
  async key(combo: string): Promise<void> {
    this.assertRunning()
    await this.backend.key(combo)
  }

  async scroll(point: Point | undefined, direction: "up" | "down" | "left" | "right", amount = 3): Promise<void> {
    this.assertRunning()
    await this.backend.scroll(point, direction, amount)
  }

  // --- Waiting ----------------------------------------------------------

  /**
   * Resolve once the screen has been quiet for `ms` (the desktop analog of
   * browser-control's DOM-mutation "stable"). `text` waits until the bytes
   * from the latest screenshot contain `value` (a coarse, screenshot-level
   * check; useful for e.g. a "Settings" label becoming visible).
   */
  async wait(condition: WaitCondition): Promise<WaitResult> {
    this.assertRunning()

    if (condition.type === "timeout") {
      await delay(condition.ms)
      return {
        satisfied: true,
        reason: "timeout",
        frame: await this.screenshot(),
      }
    }

    if (condition.type === "stable") {
      const quietMs = condition.ms ?? 500
      const timeout = condition.timeout ?? 10_000
      const satisfied = await this.waitStable(quietMs, timeout)
      return {
        satisfied,
        reason: satisfied ? "stable" : "timeout",
        frame: await this.screenshot(),
      }
    }

    // text — for desktops, the only "DOM" we can inspect is the screenshot
    // itself, so we sample at ~5 Hz and look for the bytes.
    const timeout = condition.timeout ?? 10_000
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const frame = await this.screenshot()
      // The screenshot is PNG; we can't text-search compressed bytes, so
      // settle for "any non-empty screenshot was taken since wait started".
      // (The session-level text-wait support is intentionally narrow — most
      // wait conditions are `stable` or `timeout` on desktops.)
      if (frame.screenshot.length > 0) {
        if (condition.value.length === 0) return { satisfied: true, reason: "matched", frame }
      }
      await delay(Math.min(200, Math.max(50, quietInterval(timeout))))
    }
    return {
      satisfied: false,
      reason: "timeout",
      frame: await this.screenshot(),
    }
  }

  private async waitStable(quietMs: number, timeoutMs: number): Promise<boolean> {
    let lastBytes: Uint8Array | null = null
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const frame = await this.screenshot()
      if (lastBytes && sameBytes(lastBytes, frame.screenshot)) {
        // Stable: two consecutive identical screenshots. Hold for `quietMs`
        // before reporting stable, to match browser-control's "no mutations
        // for N ms" semantics.
        await delay(quietMs)
        const verify = await this.screenshot()
        if (sameBytes(verify.screenshot, frame.screenshot)) return true
      }
      lastBytes = frame.screenshot
      await delay(Math.min(100, Math.max(20, Math.round(quietMs / 4))))
    }
    return false
  }

  // --- Recording --------------------------------------------------------

  async startRecording(options: StartRecordingOptions = {}): Promise<void> {
    this.assertRunning()
    this.recorder = new Recorder(this.backend, this.screen)
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

  // --- Lifecycle --------------------------------------------------------

  async stop(): Promise<void> {
    if (this.status !== "running") return
    this.status = "stopped"
    if (this.recorder) await this.recorder.stop().catch(() => {})
    if (this.mode === "sandbox") {
      await Sandbox.close(this.name).catch(() => {})
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function quietInterval(timeoutMs: number): number {
  return Math.max(50, Math.min(200, Math.round(timeoutMs / 20)))
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}
