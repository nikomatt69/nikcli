import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface ServerStatus {
  connected: boolean
  latency: number
  lastPing: Date | null
}

interface ServerContextValue {
  status: () => ServerStatus
  connect: () => Promise<void>
  disconnect: () => void
  ping: () => Promise<number>
}

const ServerContext = createContext<ServerContextValue>()

export function ServerProvider(props: { children: JSX.Element }) {
  const [status, setStatus] = createSignal<ServerStatus>({
    connected: false,
    latency: 0,
    lastPing: null,
  })

  const connect = async () => {
    // TODO: Implement WebSocket connection to nikcli server
    setStatus((prev) => ({ ...prev, connected: true }))
  }

  const disconnect = () => {
    setStatus((prev) => ({ ...prev, connected: false }))
  }

  const ping = async () => {
    const start = performance.now()
    // TODO: Send ping
    const latency = performance.now() - start
    setStatus((prev) => ({ ...prev, latency, lastPing: new Date() }))
    return latency
  }

  return <ServerContext.Provider value={{ status, connect, disconnect, ping }}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const context = useContext(ServerContext)
  if (!context) {
    throw new Error("useServer must be used within ServerProvider")
  }
  return context
}
