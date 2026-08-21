/**
 * SessionManager â€” an in-memory registry of named {@link BrowserSession}s.
 * Each session owns a Bun.WebView. The daemon wraps this over a Unix socket
 * so sessions outlive any single CLI invocation.
 */
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

  /**
   * The session, marked as being used right now.
   *
   * Only for calls that actually drive the page. Asking a session what it is
   * doing â€” {@link info}, {@link isRecording}, {@link recordingData},
   * {@link videoPath}, {@link rawConsole} â€” must not count, or a client polling
   * status on a timer would keep a browser alive forever, which is the leak
   * {@link reapIdle} exists to close.
   */
  private drive(name: string): BrowserSession {
    const session = this.require(name)
    session.touch()
    return session
  }

  /**
   * Stop sessions nobody has touched for `maxIdleMs`, and report their names.
   *
   * A running session holds a browser â€” eleven OS processes on Windows â€” for as
   * long as it exists, and the daemon's own idle shutdown cannot help: it waits
   * for zero running sessions, so one forgotten `start` pins the browser
   * indefinitely. Stopping the session is what eventually lets the daemon go.
   *
   * Sessions are stopped, not removed, matching {@link stop}: post-mortem
   * artifacts stay reachable, and `restart` still works on the name.
   */
  async reapIdle(maxIdleMs: number): Promise<string[]> {
    if (maxIdleMs <= 0) return []
    const cutoff = Date.now() - maxIdleMs
    const reaped: string[] = []
    for (const [name, session] of this.sessions) {
      if (!session.isRunning() || session.isBusy() || session.lastUsedAt > cutoff) continue
      await session.stop().catch(() => {})
      reaped.push(name)
    }
    return reaped
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.info())
  }

  info(name: string): SessionInfo {
    return this.require(name).info()
  }

  goto(name: string, url: string): Promise<void> {
    return this.drive(name).goto(url)
  }

  send(name: string, input: string, mode: SendMode = "text"): Promise<void> {
    return this.drive(name).send(input, mode)
  }

  back(name: string): Promise<boolean> {
    return this.drive(name).back()
  }

  forward(name: string): Promise<boolean> {
    return this.drive(name).forward()
  }

  reload(name: string): Promise<void> {
    return this.drive(name).reload()
  }

  click(name: string, selector: string): Promise<void> {
    return this.drive(name).click(selector)
  }

  pointer(name: string, input: PointerInput): Promise<void> {
    return this.drive(name).pointer(input)
  }

  key(name: string, input: KeyInput): Promise<void> {
    return this.drive(name).key(input)
  }

  startScreencast(name: string, options?: ScreencastOptions): Promise<Screencast> {
    return this.drive(name).startScreencast(options)
  }

  stopScreencast(name: string): Promise<void> {
    return this.drive(name).stopScreencast()
  }

  fill(name: string, selector: string, value: string): Promise<void> {
    return this.drive(name).fill(selector, value)
  }

  hover(name: string, selector: string): Promise<void> {
    return this.drive(name).hover(selector)
  }

  scroll(name: string, dx: number, dy: number): Promise<void> {
    return this.drive(name).scroll(dx, dy)
  }

  wait(name: string, condition: WaitCondition): Promise<WaitResult> {
    return this.drive(name).wait(condition)
  }

  resize(name: string, width: number, height: number): Promise<SessionInfo> {
    return this.drive(name).resize(width, height)
  }

  snapshot(name: string): Promise<BrowserFrame> {
    return this.drive(name).snapshot()
  }

  text(name: string): Promise<string> {
    return this.drive(name).text()
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
    return this.drive(name).startRecording(options)
  }

  marker(name: string, markerName: string): Promise<RecordingMarker | undefined> {
    return this.drive(name).marker(markerName)
  }

  stopRecording(name: string): Promise<RecordingData | null> {
    return this.drive(name).stopRecording()
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

  /**
   * Close every session and forget them.
   *
   * Deliberately does *not* call `Bun.WebView.closeAll()`. That SIGKILLs the
   * browser subprocess the whole Bun process shares, and Bun does not recover:
   * every later `new Bun.WebView()` fails with "Chrome process closed the pipe"
   * and then "Failed to spawn Chrome", for the life of the process. In a daemon
   * â€” which is the whole nikcli session when it is hosted in-process â€” one
   * `close-all` would leave the browser tool dead until a restart. Closing each
   * view is enough; the subprocess goes away with its parent.
   */
  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) await session.stop()
    this.sessions.clear()
  }
}
