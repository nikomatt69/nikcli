/**
 * SessionManager — an in-memory registry of named {@link BrowserSession}s that
 * share one lazily-launched, headless Chromium process. Framework agnostic;
 * the daemon ({@link daemon.ts}) wraps this to expose it over a Unix socket so
 * sessions outlive any single CLI invocation, the way `SessionManager` in
 * terminal-control outlives any single `send`/`wait` call against a PTY.
 */
import type { Browser } from "playwright"
import {
  BrowserSession,
  type SessionInfo,
  type SessionOptions,
  type SendMode,
  type WaitCondition,
  type WaitResult,
} from "./session"
import type { BrowserFrame } from "./frame"
import type { RecordingData, RecordingMarker, StartRecordingOptions } from "./recording"

export class SessionManager {
  private readonly sessions = new Map<string, BrowserSession>()
  private browser: Browser | null = null
  private counter = 0

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      const { chromium } = await import("playwright")
      this.browser = await chromium.launch({ headless: true })
    }
    return this.browser
  }

  /** Start a new session. If `name` is omitted, one is generated. Replaces an existing same-named session. */
  async start(options: Omit<SessionOptions, "name"> & { name?: string }): Promise<SessionInfo> {
    const browser = await this.ensureBrowser()
    const name = options.name && options.name.length > 0 ? options.name : this.generateName()
    const existing = this.sessions.get(name)
    if (existing) await existing.stop()
    const session = await BrowserSession.create(browser, { ...options, name })
    this.sessions.set(name, session)
    return session.info()
  }

  private generateName(): string {
    this.counter++
    return `page-${this.counter}`
  }

  has(name: string): boolean {
    return this.sessions.has(name)
  }

  get(name: string): BrowserSession | undefined {
    return this.sessions.get(name)
  }

  get size(): number {
    return this.sessions.size
  }

  /** Sessions still holding a live browser context — used for idle shutdown, since `stop()` retains stopped sessions. */
  get runningCount(): number {
    let count = 0
    for (const session of this.sessions.values()) if (session.isRunning()) count++
    return count
  }

  private require(name: string): BrowserSession {
    const session = this.sessions.get(name)
    if (!session) throw new Error(`No browser session named "${name}". Use action "list" to see active sessions.`)
    return session
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.info())
  }

  info(name: string): SessionInfo {
    return this.require(name).info()
  }

  goto(name: string, url: string): Promise<void> {
    return this.require(name).goto(url)
  }

  send(name: string, input: string, mode: SendMode = "text"): Promise<void> {
    return this.require(name).send(input, mode)
  }

  click(name: string, selector: string): Promise<void> {
    return this.require(name).click(selector)
  }

  fill(name: string, selector: string, value: string): Promise<void> {
    return this.require(name).fill(selector, value)
  }

  hover(name: string, selector: string): Promise<void> {
    return this.require(name).hover(selector)
  }

  scroll(name: string, dx: number, dy: number): Promise<void> {
    return this.require(name).scroll(dx, dy)
  }

  wait(name: string, condition: WaitCondition): Promise<WaitResult> {
    return this.require(name).wait(condition)
  }

  resize(name: string, width: number, height: number): Promise<SessionInfo> {
    return this.require(name).resize(width, height)
  }

  snapshot(name: string): Promise<BrowserFrame> {
    return this.require(name).snapshot()
  }

  text(name: string): Promise<string> {
    return this.require(name).text()
  }

  rawConsole(name: string, lines?: number) {
    return this.require(name).rawConsole(lines)
  }

  /**
   * Stop a session but keep it registered so post-mortem artifacts (notably
   * {@link videoPath}, which Playwright only finalizes on context close) stay
   * reachable. Call {@link remove} to actually forget it.
   */
  async stop(name: string): Promise<void> {
    const session = this.sessions.get(name)
    if (!session) return
    await session.stop()
  }

  /** Forget a session entirely, stopping it first if still running. */
  async remove(name: string): Promise<void> {
    const session = this.sessions.get(name)
    if (!session) return
    await session.stop()
    this.sessions.delete(name)
  }

  /** Restart a session with the same URL/viewport. */
  async restart(name: string): Promise<SessionInfo> {
    const session = this.require(name)
    const prev = session.info()
    await session.stop()
    this.sessions.delete(name)
    return this.start({ name, url: prev.url || undefined, viewport: prev.viewport })
  }

  // --- Recording --------------------------------------------------------

  startRecording(name: string, options?: StartRecordingOptions): Promise<void> {
    return this.require(name).startRecording(options)
  }

  marker(name: string, markerName: string): Promise<RecordingMarker | undefined> {
    return this.require(name).marker(markerName)
  }

  stopRecording(name: string): Promise<RecordingData | null> {
    return this.require(name).stopRecording()
  }

  recordingData(name: string): RecordingData | null {
    return this.require(name).recordingData()
  }

  isRecording(name: string): boolean {
    return this.require(name).isRecording()
  }

  videoPath(name: string): Promise<string | undefined> {
    return this.require(name).videoPath()
  }

  /** Close every session, the shared browser, and clear the registry. */
  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) await session.stop()
    this.sessions.clear()
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }
}
