import { useCallback, useEffect, useRef, useState } from "react"
import "@xterm/xterm/css/xterm.css"
import { getErrorMessage, type Pty, WebNikcliClient } from "@/app/api"
import { Banner, Button, Chip, cn, EmptyState, Spinner, Surface } from "@/app/ui"

type ConnectionState = "idle" | "connecting" | "open" | "closed"

export function TerminalScreen(props: { client: WebNikcliClient | null }) {
  const { client } = props
  const [ptys, setPtys] = useState<Pty[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>("idle")
  const containerRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setMessage(null)
      const list = await client.listPtys()
      setPtys(list)
      setActiveId((current) => {
        if (current && list.some((pty) => pty.id === current)) return current
        return list.find((pty) => pty.status === "running")?.id ?? null
      })
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const create = useCallback(async () => {
    if (!client) return
    try {
      setCreating(true)
      setMessage(null)
      const pty = await client.createPty({ title: "Web terminal" })
      setActiveId(pty.id)
      await load()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }, [client, load])

  const remove = useCallback(
    async (ptyID: string) => {
      if (!client) return
      try {
        setRemoving(ptyID)
        await client.removePty(ptyID)
        setActiveId((current) => (current === ptyID ? null : current))
        await load()
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setRemoving(null)
      }
    },
    [client, load],
  )

  useEffect(() => {
    if (!client || !activeId || !containerRef.current) return
    const container = containerRef.current
    let disposed = false
    let socket: WebSocket | null = null
    let term: import("@xterm/xterm").Terminal | null = null
    let fit: import("@xterm/addon-fit").FitAddon | null = null
    let resizeObserver: ResizeObserver | null = null

    setConnection("connecting")

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      if (disposed) return

      const styles = getComputedStyle(document.documentElement)
      const readVar = (name: string, fallback: string) => {
        const value = styles.getPropertyValue(name).trim()
        return value ? `rgb(${value})` : fallback
      }

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        theme: {
          background: readVar("--terminal-code", "#0d1117"),
          foreground: readVar("--terminal-text", "#e6edf3"),
        },
        convertEol: false,
        scrollback: 4000,
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      term.open(container)
      fit.fit()

      socket = new WebSocket(client.ptySocketUrl(activeId))

      socket.onopen = () => {
        if (disposed) return
        setConnection("open")
        if (term && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }))
        }
        term?.focus()
      }
      socket.onmessage = (event) => {
        const data = typeof event.data === "string" ? event.data : ""
        if (data) term?.write(data)
      }
      socket.onclose = () => {
        if (!disposed) setConnection("closed")
      }
      socket.onerror = () => {
        if (!disposed) {
          setConnection("closed")
          setMessage("Terminal connection failed")
        }
      }

      term.onData((data) => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(data)
      })

      resizeObserver = new ResizeObserver(() => {
        if (!term || !fit) return
        fit.fit()
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }))
        }
      })
      resizeObserver.observe(container)
    })()

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      socket?.close()
      term?.dispose()
      container.innerHTML = ""
      setConnection("idle")
    }
  }, [activeId, client])

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Terminal"
        title="Remote shell on the connected host"
        description="The same PTY sessions available in the mobile terminal tab: open a shell on the server, run commands, and reconnect to running sessions."
        actions={
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            <Button className="w-full sm:w-auto" busy={creating} onClick={() => void create()}>
              New terminal
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Chip label={`${ptys.length} sessions`} tone="accent" />
          <Chip
            label={connection === "open" ? "Connected" : connection === "connecting" ? "Connecting" : "Disconnected"}
            tone={connection === "open" ? "good" : connection === "connecting" ? "accent" : "neutral"}
          />
        </div>
      </Surface>

      {message ? <Banner>{message}</Banner> : null}

      {loading && !ptys.length ? (
        <Surface title="Loading terminals">
          <Spinner label="Listing PTY sessions" />
        </Surface>
      ) : ptys.length === 0 ? (
        <EmptyState
          title="No terminal sessions"
          description="Open a new terminal to run commands directly on the connected Nikcli host."
          action={
            <Button busy={creating} onClick={() => void create()}>
              Open terminal
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {ptys.map((pty) => (
              <div key={pty.id} className="flex items-center gap-1">
                <button
                  onClick={() => setActiveId(pty.id)}
                  className={cn(
                    "rounded-full border px-3 py-2 text-xs font-semibold transition",
                    activeId === pty.id
                      ? "border-terminal-accent/30 bg-terminal-accent/10 text-terminal-accent"
                      : "border-terminal-border bg-terminal-panel text-terminal-muted hover:text-terminal-text",
                  )}
                >
                  {pty.title || pty.command}
                  {pty.status === "exited" ? " (exited)" : ""}
                </button>
                <Button variant="ghost" busy={removing === pty.id} onClick={() => void remove(pty.id)}>
                  x
                </Button>
              </div>
            ))}
          </div>

          {activeId ? (
            <div className="overflow-hidden rounded-[24px] border border-terminal-border bg-terminal-code shadow-strong">
              <div ref={containerRef} className="h-[55dvh] min-h-[20rem] w-full p-2" />
            </div>
          ) : (
            <EmptyState title="Select a terminal" description="Pick a session above or open a new terminal." />
          )}
        </div>
      )}
    </div>
  )
}
