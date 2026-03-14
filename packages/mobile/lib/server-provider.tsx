import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react"
import { clearServerConfig, getServerConfig, setServerConfig } from "@/lib/storage"
import { MobileClient } from "@/lib/client"
import type { MobileBootstrap, ServerConfig } from "@/lib/types"

type ServerContextValue = {
  config: ServerConfig | null
  loading: boolean
  client: MobileClient | null
  bootstrap: MobileBootstrap | null
  refreshBootstrap(): Promise<MobileBootstrap | null>
  save(config: ServerConfig): Promise<void>
  clear(): Promise<void>
}

const ServerContext = createContext<ServerContextValue | undefined>(undefined)

export function ServerProvider(props: PropsWithChildren) {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null)

  useEffect(() => {
    getServerConfig()
      .then((value) => setConfig(value))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!config) {
      setBootstrap(null)
      return
    }

    const client = new MobileClient(config)
    client
      .bootstrap()
      .then((value) => setBootstrap(value))
      .catch(() => setBootstrap(null))
  }, [config])

  const value = useMemo<ServerContextValue>(
    () => ({
      config,
      loading,
      client: config ? new MobileClient(config) : null,
      bootstrap,
      async refreshBootstrap() {
        if (!config) {
          setBootstrap(null)
          return null
        }
        const next = await new MobileClient(config).bootstrap()
        setBootstrap(next)
        return next
      },
      async save(next) {
        await setServerConfig(next)
        setConfig(next)
      },
      async clear() {
        await clearServerConfig()
        setConfig(null)
        setBootstrap(null)
      },
    }),
    [bootstrap, config, loading],
  )

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const value = useContext(ServerContext)
  if (!value) throw new Error("useServer must be used inside ServerProvider")
  return value
}
