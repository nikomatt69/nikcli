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

  // Stable client instance — only recreated when config changes
  const client = useMemo(() => (config ? new MobileClient(config) : null), [config])

  useEffect(() => {
    let mounted = true
    getServerConfig()
      .then((value) => { if (mounted) setConfig(value) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!config || !client) {
      setBootstrap(null)
      setBootstrapLoading(false)
      return
    }

    let mounted = true
    setBootstrapLoading(true)
    client
      .bootstrap()
      .then((value) => { if (mounted) setBootstrap(value) })
      .catch(() => { if (mounted) setBootstrap(null) })
      .finally(() => { if (mounted) setBootstrapLoading(false) })
    return () => { mounted = false }
  }, [config, client])

  const value = useMemo<ServerContextValue>(
    () => ({
      config,
      loading,
      ready: !loading,
      client,
      bootstrap,
      bootstrapLoading,
      async refreshBootstrap() {
        if (!config || !client) {
          setBootstrap(null)
          setBootstrapLoading(false)
          return null
        }
        setBootstrapLoading(true)
        try {
          const next = await client.bootstrap()
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
    [bootstrap, bootstrapLoading, client, config, loading],
  )

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const value = useContext(ServerContext)
  if (!value) throw new Error("useServer must be used inside ServerProvider")
  return value
}
