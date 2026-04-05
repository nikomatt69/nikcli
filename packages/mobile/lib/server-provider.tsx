import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react"
import { clearServerConfig, getServerConfig, setServerConfig, getUserToken, setUserToken, clearUserToken } from "@/lib/storage"
import { MobileClient } from "@/lib/client"
import type { MobileBootstrap, ServerConfig } from "@/lib/types"

export type UserProfile = {
  id: string
  username: string
  email: string
  display_name: string | null
  role: "admin" | "user"
  created_at: number
  updated_at: number
}

async function userFetch<T>(serverUrl: string, path: string, options?: RequestInit & { token?: string }): Promise<T> {
  const base = serverUrl.replace(/\/$/, "")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (options?.token) headers["Authorization"] = `Bearer ${options.token}`
  const res = await fetch(`${base}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(body.error || res.statusText)
  }
  return res.json() as Promise<T>
}

export function userLogin(serverUrl: string, email: string, password: string): Promise<{ token: string; user: UserProfile }> {
  return userFetch(serverUrl, "/user/login", { method: "POST", body: JSON.stringify({ email, password }) })
}

export function userRegister(
  serverUrl: string,
  data: { username: string; email: string; password: string; displayName?: string },
  adminToken?: string,
): Promise<{ token: string; user: UserProfile }> {
  return userFetch(serverUrl, "/user/register", { method: "POST", body: JSON.stringify(data), token: adminToken })
}

export function userMe(serverUrl: string, token: string): Promise<UserProfile> {
  return userFetch(serverUrl, "/user/me", { token })
}

export function userLogoutApi(serverUrl: string, token: string): Promise<{ ok: boolean }> {
  return userFetch(serverUrl, "/user/logout", { method: "POST", token })
}

export function userStatus(serverUrl: string): Promise<{ hasUsers: boolean }> {
  return userFetch(serverUrl, "/user/status")
}

export function userList(serverUrl: string, token: string): Promise<UserProfile[]> {
  return userFetch(serverUrl, "/user/list", { token })
}

export function userUpdate(
  serverUrl: string,
  token: string,
  id: string,
  data: { displayName?: string; password?: string; role?: "admin" | "user" },
): Promise<UserProfile> {
  return userFetch(serverUrl, `/user/${id}`, { method: "PATCH", body: JSON.stringify(data), token })
}

export function userDelete(serverUrl: string, token: string, id: string): Promise<{ ok: boolean }> {
  return userFetch(serverUrl, `/user/${id}`, { method: "DELETE", token })
}

type ServerContextValue = {
  config: ServerConfig | null
  loading: boolean
  ready: boolean
  client: MobileClient | null
  bootstrap: MobileBootstrap | null
  bootstrapLoading: boolean
  currentUser: UserProfile | null
  userToken: string | null
  userLoading: boolean
  refreshBootstrap(): Promise<MobileBootstrap | null>
  save(config: ServerConfig): Promise<void>
  clear(): Promise<void>
  setUserSession(token: string, user: UserProfile): Promise<void>
  signOut(): Promise<void>
}

const ServerContext = createContext<ServerContextValue | undefined>(undefined)

export function ServerProvider(props: PropsWithChildren) {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [userToken, setUserTokenState] = useState<string | null>(null)
  const [userLoading, setUserLoading] = useState(true)

  // Stable client instance — only recreated when config changes
  const client = useMemo(() => (config ? new MobileClient(config) : null), [config])

  useEffect(() => {
    let mounted = true
    Promise.all([getServerConfig(), getUserToken()])
      .then(([cfg, token]) => {
        if (!mounted) return
        setConfig(cfg)
        if (token && cfg) {
          setUserTokenState(token)
          userMe(cfg.url, token)
            .then((user) => { if (mounted) setCurrentUser(user) })
            .catch(() => {
              if (mounted) {
                setUserTokenState(null)
                setCurrentUser(null)
              }
              clearUserToken()
            })
            .finally(() => { if (mounted) setUserLoading(false) })
        } else {
          setUserLoading(false)
        }
      })
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
      currentUser,
      userToken,
      userLoading,
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
      async setUserSession(token, user) {
        await setUserToken(token)
        setUserTokenState(token)
        setCurrentUser(user)
      },
      async signOut() {
        if (userToken && config) {
          await userLogoutApi(config.url, userToken).catch(() => undefined)
        }
        await clearUserToken()
        setUserTokenState(null)
        setCurrentUser(null)
      },
    }),
    [bootstrap, bootstrapLoading, client, config, currentUser, loading, userLoading, userToken],
  )

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const value = useContext(ServerContext)
  if (!value) throw new Error("useServer must be used inside ServerProvider")
  return value
}
