/**
 * SessionManager — an in-memory registry of named {@link BrowserSession}s.
 * Each session owns a Bun.WebView. The daemon wraps this over a Unix socket
 * so sessions outlive any single CLI invocation.
 */
import { bunUtils } from "@nikcli-ai/util/bun-utils"
import {
  BrowserSession,
  type KeyInput,
  type PointerInput,
  type SessionInfo,
  type SessionOptions,
  type SendMode,
  type WaitCondition,
  type WaitResult,
} from "./session"
import type { BrowserFrame } from "./frame"
import type { RecordingData, RecordingMarker, StartRecordingOptions } from "./recording"
import type { Screencast, ScreencastOptions } from "./screencast"

export class SessionManager {
  private readonly sessions = new Map<string, BrowserSession>()
  private counter = 0

  async start(options: Omit<SessionOptions, "name"> & { name?: string }): Promise<SessionInfo> {
    const name = options.name && options.name.length > 0 ? options.name : this.generateName()
    const existing = this.sessions.get(name)
    if (existing) await existing.stop()
    const session = await BrowserSession.create({ ...options, name })
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

  back(name: string): Promise<boolean> {
    return this.require(name).back()
  }

  forward(name: string): Promise<boolean> {
    return this.require(name).forward()
  }

  reload(name: string): Promise<void> {
    return this.require(name).reload()
  }

  click(name: string, selector: string): Promise<void> {
    return this.require(name).click(selector)
  }

  pointer(name: string, input: PointerInput): Promise<void> {
    return this.require(name).pointer(input)
  }

  key(name: string, input: KeyInput): Promise<void> {
    return this.require(name).key(input)
  }

  startScreencast(name: string, options?: ScreencastOptions): Promise<Screencast> {
    return this.require(name).startScreencast(options)
  }

  stopScreencast(name: string): Promise<void> {
    return this.require(name).stopScreencast()
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
   * Stop a session but keep it registered so post-mortem artifacts
   * ({@link videoPath}) stay reachable. Call {@link remove} to forget it.
   */
  async stop(name: string): Promise<void> {
    const session = this.sessions.get(name)
    if (!session) return
    await session.stop()
  }

  async remove(name: string): Promise<void> {
    const session = this.sessions.get(name)
    if (!session) return
    await session.stop()
    this.sessions.delete(name)
  }

  async restart(name: string): Promise<SessionInfo> {
    const session = this.require(name)
    const prev = session.info()
    await session.stop()
    this.sessions.delete(name)
    return this.start({ name, url: prev.url || undefined, viewport: prev.viewport })
  }

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

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) await session.stop()
    this.sessions.clear()
    bunUtils.WebView?.closeAll()
  }
}
