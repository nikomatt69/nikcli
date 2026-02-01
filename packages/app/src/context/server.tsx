import { createContext, useContext, createSignal, createEffect, onCleanup, type JSX } from "solid-js"
import { useApi } from "./api"
import { useApp } from "./app"

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
  const { sdk } = useApi()
  const { setError } = useApp()
  const [status, setStatus] = createSignal<ServerStatus>({
    connected: false,
    latency: 0,
    lastPing: null,
  })

  const connect = async () => {
    await ping()
  }

  const disconnect = () => {
    setStatus((prev) => ({ ...prev, connected: false }))
  }

  const ping = async () => {
    const start = performance.now()
    const result = await sdk().global.health()
    const end = performance.now()
    const latency = end - start

    if (result.error) {
      const code = result.response?.status
      const message = code === 401 ? "Authentication required for Nikcli server." : "Unable to reach Nikcli server."
      setError(message)
      setStatus((prev) => ({ ...prev, connected: false, latency: 0, lastPing: new Date() }))
      return 0
    }

    setError(null)
    setStatus((prev) => ({ ...prev, connected: true, latency, lastPing: new Date() }))
    return latency
  }

  createEffect(() => {
    sdk()
    void ping()
    const timer = window.setInterval(() => {
      void ping()
    }, 15000)
    onCleanup(() => window.clearInterval(timer))
  })

  return <ServerContext.Provider value={{ status, connect, disconnect, ping }}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const context = useContext(ServerContext)
  if (!context) {
    throw new Error("useServer must be used within ServerProvider")
  }
  return context
}
