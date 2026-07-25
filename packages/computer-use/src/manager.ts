/**
 * SessionManager — an in-memory registry of named {@link ComputerSession}s.
 * Mirrors `@nikcli-ai/browser-control`'s SessionManager one-to-one: start
 * with a name (auto-generated if missing), look up by name, drive via the
 * session's chosen backend (`sandbox` or `host`), record markers, and
 * forget on stop.
 *
 * Framework agnostic; the background daemon (`daemon.ts`) wraps this to
 * expose it over a Unix socket so sessions outlive any single CLI
 * invocation.
 */
import { ComputerSession, type SessionInfo, type SessionOptions, type WaitCondition, type WaitResult } from "./session"
import type { ComputerFrame } from "./frame"
import type { Point, MouseButton } from "./backends"
import type { RecordingData, RecordingMarker, StartRecordingOptions } from "./recording"

export class SessionManager {
  private readonly sessions = new Map<string, ComputerSession>()
  private counter = 0

  /** Start a new session. If `name` is omitted, one is generated. Replaces an existing same-named session. */
  async start(
    nikcliSessionID: string,
    options: Omit<SessionOptions, "name"> & { name?: string },
  ): Promise<SessionInfo> {
    const name = options.name && options.name.length > 0 ? options.name : this.generateName()
    const existing = this.sessions.get(name)
    if (existing) await existing.stop()
    const session = await ComputerSession.create(nikcliSessionID, {
      ...options,
      name,
    })
    this.sessions.set(name, session)
    return session.info()
  }

  private generateName(): string {
    this.counter++
    return `desk-${this.counter}`
  }

  has(name: string): boolean {
    return this.sessions.has(name)
  }

  get(name: string): ComputerSession | undefined {
    return this.sessions.get(name)
  }

  get size(): number {
    return this.sessions.size
  }

  /** Sessions still holding a live desktop — used for idle shutdown. */
  get runningCount(): number {
    let count = 0
    for (const session of this.sessions.values()) if (session.isRunning()) count++
    return count
  }

  private require(name: string): ComputerSession {
    const session = this.sessions.get(name)
    if (!session) throw new Error(`No computer session named "${name}". Use action "list" to see active sessions.`)
    return session
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.info())
  }

  info(name: string): SessionInfo {
    return this.require(name).info()
  }

  // --- Driving ----------------------------------------------------------

  screenshot(name: string): Promise<ComputerFrame> {
    return this.require(name).screenshot()
  }

  screenSize(name: string): Promise<{ width: number; height: number }> {
    return this.require(name).screenSize()
  }

  moveMouse(name: string, point: Point): Promise<void> {
    return this.require(name).moveMouse(point)
  }

  click(name: string, point: Point | undefined, button: MouseButton = "left", double = false): Promise<void> {
    return this.require(name).click(point, button, double)
  }

  drag(name: string, from: Point, to: Point): Promise<void> {
    return this.require(name).drag(from, to)
  }

  type(name: string, text: string): Promise<void> {
    return this.require(name).type(text)
  }

  key(name: string, combo: string): Promise<void> {
    return this.require(name).key(combo)
  }

  scroll(
    name: string,
    point: Point | undefined,
    direction: "up" | "down" | "left" | "right",
    amount = 3,
  ): Promise<void> {
    return this.require(name).scroll(point, direction, amount)
  }

  wait(name: string, condition: WaitCondition): Promise<WaitResult> {
    return this.require(name).wait(condition)
  }

  // --- Lifecycle --------------------------------------------------------

  /** Stop a session but keep it registered so the desktop's `liveUrl` (sandbox) stays reachable until {@link remove} is called. */
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

  /** Restart a session with the same mode/size. */
  async restart(nikcliSessionID: string, name: string): Promise<SessionInfo> {
    const session = this.require(name)
    const prev = session.info()
    await session.stop()
    this.sessions.delete(name)
    return this.start(nikcliSessionID, {
      name,
      mode: prev.mode,
      width: prev.screen.width,
      height: prev.screen.height,
    })
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

  /** Close every session and clear the registry. */
  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) await session.stop()
    this.sessions.clear()
  }
}
