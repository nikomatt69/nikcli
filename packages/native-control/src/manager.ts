import type { Surface, SurfaceEvent } from "@nikcli-ai/native-ui-protocol"
import { NativeSession, type WaitCondition } from "./session"

export class SessionManager {
  private readonly sessions = new Map<string, NativeSession>()
  private counter = 0

  start(input: { name?: string; url: string }) {
    const name = input.name || `native-${++this.counter}`
    this.sessions.get(name)?.stop()
    const session = new NativeSession(name, input.url)
    this.sessions.set(name, session)
    return session.info()
  }

  list() {
    return [...this.sessions.values()].map((session) => session.info())
  }
  info(name: string) {
    return this.require(name).info()
  }
  open(name: string, surface: Surface) {
    return this.require(name).open(surface)
  }
  update(name: string, surface: Surface) {
    return this.require(name).update(surface)
  }
  close(name: string, surfaceID: string) {
    return this.require(name).close(surfaceID)
  }
  dispatch(name: string, event: SurfaceEvent) {
    return this.require(name).dispatch(event)
  }
  snapshot(name: string) {
    return this.require(name).snapshot()
  }
  wait(name: string, condition: WaitCondition) {
    return this.require(name).wait(condition)
  }
  stop(name: string) {
    this.require(name).stop()
  }
  remove(name: string) {
    this.sessions.get(name)?.stop()
    this.sessions.delete(name)
  }
  closeAll() {
    for (const session of this.sessions.values()) session.stop()
    this.sessions.clear()
  }
  get runningCount() {
    return [...this.sessions.values()].filter((session) => session.info().status === "running").length
  }

  private require(name: string) {
    const session = this.sessions.get(name)
    if (!session) throw new Error(`No native session named "${name}". Use action "list" to inspect sessions.`)
    return session
  }
}
