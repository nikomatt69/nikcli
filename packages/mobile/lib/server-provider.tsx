import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react"
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

  const configRef = useRef<ServerConfig | null>(null)
  const clientRef = useRef<MobileClient | null>(null)

  useEffect(() => {
    let mounted = true
    getServerConfig()
      .then((value) => {
        if (mounted) {
          setConfig(value)
          configRef.current = value
        }
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!config) {
      setBootstrap(null)
      setBootstrapLoading(false)
      clientRef.current = null
      return
    }

    const client = new MobileClient(config)
    clientRef.current = client

    let mounted = true
    setBootstrapLoading(true)
    client
      .bootstrap()
      .then((value) => {
        if (mounted) setBootstrap(value)
      })
      .catch(() => {
        if (mounted) setBootstrap(null)
      })
      .finally(() => {
        if (mounted) setBootstrapLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [config])

  const value = useMemo<ServerContextValue>(
    () => ({
      config,
      loading,
      ready: !loading,
      client: clientRef.current,
      bootstrap,
      bootstrapLoading,
      async refreshBootstrap() {
        const currentConfig = configRef.current
        const currentClient = clientRef.current
        if (!currentConfig || !currentClient) {
          setBootstrap(null)
          setBootstrapLoading(false)
          return null
        }
        setBootstrapLoading(true)
        try {
          const next = await currentClient.bootstrap()
          setBootstrap(next)
          return next
        } finally {
          setBootstrapLoading(false)
        }
      },
      async save(next) {
        await setServerConfig(next)
        setConfig(next)
        configRef.current = next
      },
      async clear() {
        await clearServerConfig()
        setConfig(null)
        configRef.current = null
        clientRef.current = null
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
