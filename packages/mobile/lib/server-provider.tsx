import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react"
import { clearServerConfig, getServerConfig, setServerConfig } from "@/lib/storage"
import { MobileClient } from "@/lib/client"
import type { MobileBootstrap, ServerConfig } from "@/lib/types"

type ServerContextValue = {
  config: ServerConfig | null
  loading: boolean
  ready: boolean
  client: MobileClient | null
  bootstrap: MobileBootstrap | null
  bootstrapLoading: boolean
  refreshBootstrap(): Promise<MobileBootstrap | null>
  save(config: ServerConfig): Promise<void>
  clear(): Promise<void>
}

const ServerContext = createContext<ServerContextValue | undefined>(undefined)

export function ServerProvider(props: PropsWithChildren) {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(false)

  useEffect(() => {
    getServerConfig()
      .then((value) => setConfig(value))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!config) {
      setBootstrap(null)
      setBootstrapLoading(false)
      return
    }

    const client = new MobileClient(config)
    setBootstrapLoading(true)
    client
      .bootstrap()
      .then((value) => setBootstrap(value))
      .catch(() => setBootstrap(null))
      .finally(() => setBootstrapLoading(false))
  }, [config])

  const value = useMemo<ServerContextValue>(
    () => ({
      config,
      loading,
      ready: !loading,
      client: config ? new MobileClient(config) : null,
      bootstrap,
      bootstrapLoading,
      async refreshBootstrap() {
        if (!config) {
          setBootstrap(null)
          setBootstrapLoading(false)
          return null
        }
        setBootstrapLoading(true)
        try {
          const next = await new MobileClient(config).bootstrap()
          setBootstrap(next)
          return next
        } finally {
          setBootstrapLoading(false)
        }
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
    [bootstrap, bootstrapLoading, config, loading],
  )

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const value = useContext(ServerContext)
  if (!value) throw new Error("useServer must be used inside ServerProvider")
  return value
}
