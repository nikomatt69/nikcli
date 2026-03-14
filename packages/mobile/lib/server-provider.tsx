import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react"
import { clearServerConfig, getServerConfig, setServerConfig } from "@/lib/storage"
import { MobileClient } from "@/lib/client"
import type { ServerConfig } from "@/lib/types"

type ServerContextValue = {
  config: ServerConfig | null
  loading: boolean
  client: MobileClient | null
  save(config: ServerConfig): Promise<void>
  clear(): Promise<void>
}

const ServerContext = createContext<ServerContextValue | undefined>(undefined)

export function ServerProvider(props: PropsWithChildren) {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getServerConfig()
      .then((value) => setConfig(value))
      .finally(() => setLoading(false))
  }, [])

  const value = useMemo<ServerContextValue>(
    () => ({
      config,
      loading,
      client: config ? new MobileClient(config) : null,
      async save(next) {
        await setServerConfig(next)
        setConfig(next)
      },
      async clear() {
        await clearServerConfig()
        setConfig(null)
      },
    }),
    [config, loading],
  )

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const value = useContext(ServerContext)
  if (!value) throw new Error("useServer must be used inside ServerProvider")
  return value
}
