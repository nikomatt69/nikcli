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
  private resizeTimeout?: ReturnType<typeof setTimeout>
  private offlineQueue: string[] = []
  private lastPong = Date.now()
  private heartbeatInterval?: ReturnType<typeof setInterval>

  private loadingEl = document.getElementById("loading")!
  private terminalContainer = document.getElementById("terminal-container")!
  private terminalEl = document.getElementById("terminal") as HTMLCanvasElement
  private statusDot = document.getElementById("status-dot")!
  private statusText = document.getElementById("status-text")!
  private hiddenInput = document.getElementById("hidden-input-overlay") as HTMLTextAreaElement
  private visibleInput = document.getElementById("visible-input") as HTMLInputElement
  private sendBtn = document.getElementById("send-btn")!
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
      this.setupKeyboardEvents()
      this.setupMobileKeyboardHandling()

      // Set up resize observer for terminal container
      const observer = new ResizeObserver(() => {
        clearTimeout(this.resizeTimeout)
        this.resizeTimeout = setTimeout(() => this.resize(), 100)
      })
      observer.observe(this.terminalContainer)

      // Also listen to window resize for better mobile handling with 100dvh
      window.addEventListener("resize", () => {
        clearTimeout(this.resizeTimeout)
        this.resizeTimeout = setTimeout(() => this.resize(), 100)
      })

      // Handle orientation change on mobile
      window.addEventListener("orientationchange", () => {
        setTimeout(() => this.resize(), 100)
      })
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "Failed to initialize")
    }
  }

  private setupMobileKeyboardHandling() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    if (!isMobile) return

    // Set up visualViewport API for keyboard detection
    if (visualViewport) {
      let pendingResize = false
      let lastViewportHeight = visualViewport.height

      const handleViewportResize = () => {
        if (pendingResize) return
        pendingResize = true

        requestAnimationFrame(() => {
          this.handleVisualViewportChange(lastViewportHeight)
          lastViewportHeight = visualViewport!.height
          pendingResize = false
        })
      }

      visualViewport.addEventListener("resize", handleViewportResize)
      visualViewport.addEventListener("scroll", handleViewportResize)

      // Initial calculation
      this.handleVisualViewportChange(lastViewportHeight)
    } else {
      // Fallback for browsers without visualViewport API
      // Use window resize event and compare heights
      let lastHeight = window.innerHeight
      window.addEventListener("resize", () => {
        const currentHeight = window.innerHeight
        const heightDiff = lastHeight - currentHeight

        // If height decreased significantly (more than 100px), keyboard likely appeared
        if (heightDiff > 100) {
          document.body.classList.add("keyboard-visible")
          this.resize()
        } else if (heightDiff < -50) {
          // Height increased, keyboard disappeared
          document.body.classList.remove("keyboard-visible")
          setTimeout(() => this.resize(), 100)
        }

        lastHeight = currentHeight
      })
    }

    // Touch-to-focus: tap on terminal to focus hidden input
    this.terminalContainer.addEventListener("click", (e) => {
      // Don't steal focus if clicking on interactive elements
      if ((e.target as HTMLElement).closest(".qkey, #send-btn, #visible-input")) {
        return
      }
      this.hiddenInput.focus()
    })

    this.terminalContainer.addEventListener("touchstart", (e) => {
      // Don't steal focus if touching interactive elements
      if ((e.target as HTMLElement).closest(".qkey, #send-btn, #visible-input")) {
        return
      }
      // Small delay to let any built-in focus behavior complete
      setTimeout(() => {
        this.hiddenInput.focus()
      }, 10)
    }, { passive: true })

    // Listen for focus/blur on hidden input to detect keyboard state
    this.hiddenInput.addEventListener("focus", () => {
      // Keyboard is about to show
    })

    this.hiddenInput.addEventListener("blur", () => {
      // Keyboard is hidden
      document.body.classList.remove("keyboard-visible")
      setTimeout(() => this.resize(), 100)
    })
  }

  private handleVisualViewportChange(lastHeight: number) {
    if (!visualViewport) return

    const viewport = visualViewport
    const windowHeight = window.innerHeight
    const viewportHeight = viewport.height

    // Detect keyboard show/hide by comparing viewport height changes
    // If viewport height decreased significantly, keyboard is showing
    const heightDiff = lastHeight - viewportHeight
    const keyboardThreshold = windowHeight * 0.25 // 25% of window height as threshold

    if (heightDiff > keyboardThreshold) {
      // Keyboard showing - add class
      document.body.classList.add("keyboard-visible")
    } else if (heightDiff < -keyboardThreshold / 2) {
      // Keyboard hiding - remove class
      document.body.classList.remove("keyboard-visible")
    }

    // Calculate the available height for the terminal
    // Use 100dvh for mobile to handle dynamic viewport properly
    const dvh = windowHeight

    // Update CSS custom property for terminal container
    document.documentElement.style.setProperty("--available-height", `${dvh}px`)

    // Trigger resize
    this.resize()
  }

  private async initGhostty() {
    try {
      const GhosttyModule = await import("ghostty-web")
      const GhosttyClass = GhosttyModule.Ghostty
      this.ghostty = await GhosttyClass.load("/ghostty-vt.wasm")
    } catch (e) {
      console.error("Failed to load Ghostty WASM.", e)
      throw new Error("Browser does not support the terminal engine.")
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    const pixelRatio = window.devicePixelRatio || 1

    const config: GhosttyTerminalConfig = {
      scrollbackLimit: 10000,
      fgColor: 0xe6edf3,
      bgColor: 0x0d1117,
      cursorColor: 0x58a6ff,
    }

    this.terminal = this.ghostty!.createTerminal(80, 24, config)

    const rendererOptions = {
      fontSize: (isMobile ? 15 : 14) * pixelRatio,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
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
    this.cellWidth = metrics.width / pixelRatio
    this.cellHeight = metrics.height / pixelRatio

    this.terminalEl.style.width = "100%"
    this.terminalEl.style.height = "100%"

    this.resize()
    this.render()
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

    const pixelRatio = window.devicePixelRatio || 1
    const width = this.terminalContainer.clientWidth
    const height = this.terminalContainer.clientHeight

    this.terminalEl.width = width * pixelRatio
    this.terminalEl.height = height * pixelRatio

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
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    this.ws = new WebSocket(`${protocol}//${window.location.host}`)

    this.ws.onopen = () => {
      this.setStatus("connecting", "Authenticating...")
      this.ws?.send(JSON.stringify({ type: "auth", token: this.token }))
    }

    this.ws.onmessage = (event) => {
      this.lastPong = Date.now()
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        this.handleMessage(msg)
      } catch {}
    }

    this.ws.onclose = () => {
      this.handleDisconnect()
    }

    this.ws.onerror = () => {}

    this.startHeartbeat()
  }

  private startHeartbeat() {
    clearInterval(this.heartbeatInterval)
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastPong > 15000) {
          this.ws.close()
          this.handleDisconnect()
        } else {
          this.ws.send(JSON.stringify({ type: "ping" }))
        }
      }
    }, 5000)
  }

  private handleDisconnect() {
    this.setStatus("disconnected", "Offline")
    this.terminalEl.style.opacity = "0.5"

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000)
      setTimeout(() => this.connect(), delay)
    } else {
      this.showError("Connection lost. Refresh page to reconnect.")
    }
  }

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "auth:success":
        this.loadingEl.classList.add("hidden")
        this.terminalContainer.classList.remove("hidden")
        this.terminalEl.style.opacity = "1"
        this.setStatus("connected", "Connected")
        this.reconnectAttempts = 0
        this.resize()

        while (this.offlineQueue.length > 0) {
          const queued = this.offlineQueue.shift()
          if (queued) this.send(queued, true)
        }
        break

      case "auth:failed":
        this.showError("Authentication failed - invalid token")
        break

      case "terminal:output":
        const data = msg.payload?.data ?? msg.data
        if (data && this.terminal) {
          try {
            this.terminal.write(data)
          } catch (e) {
            console.error("Render error", e)
          }
        }
        break

      case "pong":
        this.lastPong = Date.now()
        break

      case "session:end":
        this.terminal?.write("\r\n\x1b[31m[Session ended]\x1b[0m\r\n")
        this.setStatus("disconnected", "Session ended")
        if (this.ws) {
          this.ws.onclose = null
          this.ws.close()
        }
        clearInterval(this.heartbeatInterval)
        break
    }
  }

  public send(data: string, bypassQueue = false) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "terminal:input", payload: { data } }))
    } else if (!bypassQueue) {
      this.offlineQueue.push(data)
    }
  }

  private setStatus(state: "connected" | "connecting" | "disconnected", text: string) {
    this.statusDot.className = state
    this.statusText.textContent = text
  }

  private updateLoading(text: string) {
    if (this.loadingText) this.loadingText.textContent = text
  }

  private showError(message: string) {
    if (this.loadingEl) {
      this.loadingEl.classList.remove("hidden")
      this.loadingEl.innerHTML = `
        <div style="color: #f85149; font-family: monospace; padding: 20px; text-align: center; background: #161b22; border: 1px solid #f85149; border-radius: 8px;">
          ${message}
        </div>
      `
    }
  }

  private setupKeyboardEvents() {
    window.addEventListener("keydown", (e) => {
      // Don't double send if typing in the overlay
      if (document.activeElement === this.hiddenInput) return

      let keyData = ""

      if (e.key === "Enter") keyData = "\r"
      else if (e.key === "Backspace") keyData = "\x7f"
      else if (e.key === "Tab") keyData = "\t"
      else if (e.key === "Escape") keyData = "\x1b"
      else if (e.key === "ArrowUp") keyData = "\x1b[A"
      else if (e.key === "ArrowDown") keyData = "\x1b[B"
      else if (e.key === "ArrowRight") keyData = "\x1b[C"
      else if (e.key === "ArrowLeft") keyData = "\x1b[D"
      else if (e.ctrlKey && e.key.length === 1) {
        const charCode = e.key.toUpperCase().charCodeAt(0)
        if (charCode >= 65 && charCode <= 90) {
          keyData = String.fromCharCode(charCode - 64)
        }
      } else if (e.key.length === 1 && !e.altKey && !e.metaKey) {
        keyData = e.key
      }

      if (keyData) {
        e.preventDefault()
        this.send(keyData)
      }
    })

    // Native mobile input capture
    this.hiddenInput.addEventListener("input", () => {
      const val = this.hiddenInput.value
      if (val) {
        this.send(val)
        this.hiddenInput.value = ""
      }
    })

    if (this.visibleInput && this.sendBtn) {
      // Ensure input receives focus on touch
      this.visibleInput.addEventListener("touchstart", (e) => {
        e.stopPropagation()
      }, { passive: true })

      this.visibleInput.addEventListener("focus", () => {
        // On mobile, when input is focused, disable the hidden overlay
        if (this.hiddenInput) {
          this.hiddenInput.style.pointerEvents = "none"
        }
      })

      this.visibleInput.addEventListener("blur", () => {
        // Restore hidden overlay pointer events on blur
        if (this.hiddenInput) {
          this.hiddenInput.style.pointerEvents = "auto"
        }
      })

      this.sendBtn.addEventListener("click", () => {
        const val = this.visibleInput.value
        if (val) {
          this.send(val + "\r")
          this.visibleInput.value = ""
        }
        this.visibleInput.focus()
      })

      this.visibleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          this.sendBtn.click()
        }
      })
    }

    // Fallbacks for special keys on soft keyboard
    this.hiddenInput.addEventListener("keydown", (e) => {
      if (e.key === "Backspace") {
        this.send("\x7f")
      } else if (e.key === "Enter") {
        e.preventDefault()
        this.send("\r")
      }
    })

    window.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text")
      if (text) {
        e.preventDefault()
        this.send(text)
      }
    })

    document.querySelectorAll(".qkey").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = (btn as HTMLButtonElement).dataset.key
        if (key) {
          if (key === "Enter") this.send("\r")
          else if (key === "Ctrl-C") this.send("\x03")
          else if (key === "Ctrl-D") this.send("\x04")
          else if (key === "Esc") this.send("\x1b")
          else this.send(key)
        }
        this.hiddenInput.focus()
      })
    })
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new TerminalApp()
})
