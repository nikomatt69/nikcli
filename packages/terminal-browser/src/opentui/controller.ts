import type {
  BrowserKeyboardEvent,
  BrowserMouseEvent,
  TerminalBrowserSession,
  TerminalBrowserSnapshot,
  TerminalViewport,
} from "../types"

export class TerminalBrowserController {
  constructor(private readonly session: TerminalBrowserSession) {}

  getSnapshot() {
    return this.session.getSnapshot()
  }

  subscribe(listener: (snapshot: TerminalBrowserSnapshot) => void) {
    return this.session.subscribe(listener)
  }

  goto(url: string) {
    return this.session.goto(url)
  }

  back() {
    return this.session.back()
  }

  forward() {
    return this.session.forward()
  }

  reload() {
    return this.session.reload()
  }

  setViewport(viewport: TerminalViewport) {
    return this.session.setViewport(viewport)
  }

  sendMouse(event: BrowserMouseEvent) {
    return this.session.sendMouse(event)
  }

  sendKeyboard(event: BrowserKeyboardEvent) {
    return this.session.sendKeyboard(event)
  }

  dispose() {
    return this.session.dispose()
  }
}

export function createOpentuiBrowserController(session: TerminalBrowserSession) {
  return new TerminalBrowserController(session)
}
