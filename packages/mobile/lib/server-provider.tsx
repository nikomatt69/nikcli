import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react"
import { AppState } from "react-native"
import {
  clearServerConfig,
  getServerConfig,
  setServerConfig,
  getUserToken,
  setUserToken,
  clearUserToken,
} from "@/lib/storage"
import { MobileClient } from "@/lib/client"
import { getValidOAuthTokens, revokeOAuthSession } from "@/lib/oauth"
import type { OAuthTokenTriple } from "@/lib/oauth-core"
import type { MobileBootstrap, ServerConfig } from "@/lib/types"
import { ServerContext, type ServerContextValue, userLogoutApi, userMe, type UserProfile } from "@/lib/server-context"

export function ServerProvider(props: PropsWithChildren) {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [userToken, setUserTokenState] = useState<string | null>(null)
  const [userLoading, setUserLoading] = useState(true)

  const refreshOAuth = useCallback(async (force: boolean): Promise<string | null> => {
    try {
      const tokens = await getValidOAuthTokens(force)
      if (!tokens) return null
      setUserTokenState(tokens.access)
      return tokens.access
    } catch {
      setUserTokenState(null)
      setCurrentUser(null)
      return null
    }
  }, [])

  const client = useMemo(
    () =>
      config
        ? new MobileClient(
            { ...config, token: userToken ?? config.token },
            { onUnauthorized: () => refreshOAuth(true) },
          )
        : null,
    [config, refreshOAuth, userToken],
  )

  useEffect(() => {
    let mounted = true
    Promise.all([getServerConfig(), getValidOAuthTokens().catch(() => null), getUserToken()])
      .then(([cfg, oauth, legacyToken]) => {
        if (!mounted) return
        setConfig(cfg)
        const token = oauth?.access ?? legacyToken
        if (token && cfg) {
          setUserTokenState(token)
          userMe(cfg.url, token, () => refreshOAuth(true))
            .then((user) => {
              if (mounted) setCurrentUser(user)
            })
            .catch(() => {
              if (mounted) {
                setUserTokenState(null)
                setCurrentUser(null)
              }
              clearUserToken()
            })
            .finally(() => {
              if (mounted) setUserLoading(false)
            })
        } else {
          setUserLoading(false)
        }
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [refreshOAuth])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return
      void refreshOAuth(false).then((token) => {
        if (!token || !config) return
        void userMe(config.url, token)
          .then(setCurrentUser)
          .catch(() => undefined)
      })
    })
    return () => subscription.remove()
  }, [config, refreshOAuth])

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
      async save(next: ServerConfig) {
        await setServerConfig(next)
        setConfig(next)
      },
      async clear() {
        await clearServerConfig()
        setConfig(null)
        setBootstrap(null)
      },
      async setUserSession(token: string, user: UserProfile) {
        await setUserToken(token)
        setUserTokenState(token)
        setCurrentUser(user)
      },
      async setOAuthSession(tokens: OAuthTokenTriple, user: UserProfile) {
        setUserTokenState(tokens.access)
        setCurrentUser(user)
      },
      async signOut() {
        await revokeOAuthSession().catch(() => undefined)
        if (userToken && config) await userLogoutApi(config.url, userToken).catch(() => undefined)
        await clearUserToken()
        setUserTokenState(null)
        setCurrentUser(null)
      },
    }),
    [bootstrap, bootstrapLoading, client, config, currentUser, loading, userLoading, userToken],
  )

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}
