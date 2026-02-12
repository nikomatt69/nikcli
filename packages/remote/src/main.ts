import { Ghostty, CanvasRenderer, type GhosttyTerminal, type GhosttyTerminalConfig } from "ghostty-web"

interface ServerMessage {
  type: string
  payload?: {
    data?: string
    cols?: number
    rows?: number
  }
  data?: string
}

class TerminalApp {
  private ghostty: Ghostty | null = null
  private terminal: GhosttyTerminal | null = null
  private renderer: CanvasRenderer | null = null
  private ws: WebSocket | null = null
  private token: string = ""
  private cellWidth = 0
  private cellHeight = 0
  private lastCols = 0
  private lastRows = 0
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10

  private loadingEl = document.getElementById("loading")!
  private terminalContainer = document.getElementById("terminal-container")!
  private terminalEl = document.getElementById("terminal") as HTMLCanvasElement
  private statusDot = document.getElementById("status-dot")!
  private statusText = document.getElementById("status-text")!
  private inputEl = document.getElementById("input") as HTMLInputElement
  private sendBtn = document.getElementById("send")!
  private loadingText = document.getElementById("loading-text")!

  constructor() {
    const params = new URLSearchParams(window.location.search)
    this.token = params.get("t") || ""

    if (!this.token) {
      this.showError("Missing authentication token")
      return
    }

    this.init()
  }

  private async init() {
    try {
      this.updateLoading("Loading terminal engine...")
      await this.initGhostty()

      this.updateLoading("Connecting...")
      this.connect()
      this.setupEventListeners()
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "Failed to initialize")
    }
  }

  private async initGhostty() {
    const GhosttyModule = await import("ghostty-web")
    const Ghostty = GhosttyModule.Ghostty

    this.ghostty = await Ghostty.load("/ghostty-vt.wasm")

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

    const config: GhosttyTerminalConfig = {
      scrollbackLimit: 10000,
      fgColor: 0xe6edf3,
      bgColor: 0x0d1117,
      cursorColor: 0x58a6ff,
    }

    this.terminal = this.ghostty.createTerminal(80, 24, config)

    const rendererOptions = {
      fontSize: isMobile ? 16 : 14,
      fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
      cursorStyle: "block" as const,
      cursorBlink: true,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#30363d",
      },
    }

    this.renderer = new CanvasRenderer(this.terminalEl, rendererOptions)

    const metrics = this.renderer.getMetrics()
    this.cellWidth = metrics.width
    this.cellHeight = metrics.height

    this.resize()
    this.render()

    window.addEventListener("resize", () => this.resize())

    if ("serviceWorker" in navigator && window.location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {})
    }
  }

  private render = () => {
    if (!this.terminal || !this.renderer) return

    if (this.terminal.isDirty()) {
      this.renderer.render(this.terminal)
      this.terminal.clearDirty()
    }

    requestAnimationFrame(this.render)
  }

  private resize() {
    if (!this.terminal || !this.renderer) return

    const width = this.terminalEl.clientWidth || window.innerWidth
    const height = this.terminalEl.clientHeight || window.innerHeight

    const cols = Math.floor(width / this.cellWidth) || 80
    const rows = Math.floor(height / this.cellHeight) || 24

    if (cols !== this.lastCols || rows !== this.lastRows) {
      this.terminal.resize(cols, rows)
      this.renderer.resize(cols, rows)
      this.lastCols = cols
      this.lastRows = rows

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "terminal:resize",
            payload: { cols, rows },
          }),
        )
      }
    }
  }

  private connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    this.ws = new WebSocket(`${protocol}//${window.location.host}`)

    this.ws.onopen = () => {
      this.setStatus("connecting", "Authenticating...")
      this.ws?.send(JSON.stringify({ type: "auth", token: this.token }))
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        this.handleMessage(msg)
      } catch {}
    }

    this.ws.onclose = () => {
      this.setStatus("disconnected", "Disconnected")

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        const delay = Math.min(500 * this.reconnectAttempts, 5000)
        setTimeout(() => this.connect(), delay)
      } else {
        this.showError("Connection failed. Refresh to retry.")
      }
    }

    this.ws.onerror = () => {}
  }

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "auth:success":
        this.loadingEl.classList.add("hidden")
        this.terminalContainer.classList.remove("hidden")
        this.setStatus("connected", "Connected")
        this.reconnectAttempts = 0
        this.terminal?.write("\x1b[32mConnected!\x1b[0m\r\n")
        this.resize()
        break

      case "auth:failed":
        this.showError("Authentication failed - invalid token")
        break

      case "terminal:output":
        const data = msg.payload?.data ?? msg.data
        if (data && this.terminal) {
          this.terminal.write(data)
        }
        break

      case "session:end":
        this.terminal?.write("\r\n\x1b[31m[Session ended]\x1b[0m\r\n")
        this.setStatus("disconnected", "Session ended")
        break
    }
  }

  public send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "terminal:input", payload: { data } }))
    }
    this.terminal?.write(data)
  }

  private setStatus(state: "connected" | "connecting" | "disconnected", text: string) {
    this.statusDot.className = state
    this.statusText.textContent = text
  }

  private updateLoading(text: string) {
    this.loadingText.textContent = text
  }

  private showError(message: string) {
    this.loadingEl.innerHTML = `
      <div style="color: #f85149; font-family: monospace; padding: 20px; text-align: center;">
        ${message}
      </div>
    `
  }

  private setupEventListeners() {
    document.querySelectorAll(".qkey").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = (btn as HTMLButtonElement).dataset.key
        if (key) this.send(key)
        this.inputEl.focus()
      })
    })

    this.sendBtn.addEventListener("click", () => {
      if (this.inputEl.value) {
        this.send(this.inputEl.value + "\r")
        this.inputEl.value = ""
      }
      this.inputEl.focus()
    })

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        this.sendBtn.click()
      }
    })

    this.inputEl.addEventListener("paste", (e) => {
      e.preventDefault()
      const text = e.clipboardData?.getData("text")
      if (text) {
        document.execCommand("insertText", false, text)
      }
    })
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new TerminalApp()

  const inputEl = document.getElementById("input") as HTMLInputElement
  const sendBtn = document.getElementById("send")!

  sendBtn.addEventListener("click", () => {
    if (inputEl.value) {
      app.send(inputEl.value + "\r")
      inputEl.value = ""
    }
    inputEl.focus()
  })

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      sendBtn.click()
    }
  })
})
