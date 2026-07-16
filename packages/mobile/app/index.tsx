import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native"
import { router, useRootNavigationState } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ConnectionStatus } from "@/components/ConnectionStatus"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { MobileClient } from "@/lib/client"
import { useServer, userStatus } from "@/lib/server-context"
import { useAppTheme } from "@/lib/theme"
import type { ServerConfig } from "@/lib/types"

function nextRouteAfterConnect(userToken: string | null) {
  return userToken ? "/sessions" : "/login"
}

function fromLink(url: string): ServerConfig | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "nikcli:") return null
    const isLegacyConnect = parsed.hostname === "connect"
    const isRootConnect = !parsed.hostname && (parsed.pathname === "/" || parsed.pathname === "")
    if (!isLegacyConnect && !isRootConnect) return null
    const server = parsed.searchParams.get("server")
    if (!server) return null
    return {
      url: server,
      token: parsed.searchParams.get("token") || undefined,
      directory: parsed.searchParams.get("directory") || undefined,
    }
  } catch {
    return null
  }
}

export default function ConnectScreen() {
  const { palette } = useAppTheme()
  const { top } = useSafeAreaInsets()
  const { config, loading, ready, save, userToken } = useServer()
  const rootNavigationState = useRootNavigationState()
  const [url, setUrl] = useState(config?.url ?? "")
  const [token, setToken] = useState(config?.token ?? "")
  const [directory, setDirectory] = useState(config?.directory ?? "")
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!rootNavigationState?.key) return
    if (!ready) return

    let cancelled = false

    if (config) {
      setUrl(config.url)
      setToken(config.token ?? "")
      setDirectory(config.directory ?? "")

      const auth = userToken ? { ...config, token: userToken } : config
      const check = userToken || config.token ? new MobileClient(auth).ping() : userStatus(config.url).then(() => true)
      void check.then((ok) => {
        if (!cancelled && ok) {
          setConnected(true)
          router.replace(nextRouteAfterConnect(userToken))
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [config, ready, rootNavigationState?.key, userToken])

  useEffect(() => {
    let mounted = true

    void Linking.getInitialURL().then((value) => {
      if (!mounted || !value) return
      const parsed = fromLink(value)
      if (!parsed) return
      setUrl(parsed.url)
      setToken(parsed.token ?? "")
      setDirectory(parsed.directory ?? "")
    })

    const subscription = Linking.addEventListener("url", ({ url: nextUrl }) => {
      const parsed = fromLink(nextUrl)
      if (!parsed) return
      setUrl(parsed.url)
      setToken(parsed.token ?? "")
      setDirectory(parsed.directory ?? "")
    })

    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  const form = useMemo(
    () => ({ url: url.trim(), token: token.trim() || undefined, directory: directory.trim() || undefined }),
    [directory, token, url],
  )

  async function connect() {
    if (!form.url) {
      setError("Server URL is required")
      return
    }
    try {
      setTesting(true)
      setError(null)
      if (form.token) await new MobileClient(form).bootstrap()
      else await userStatus(form.url)
      await save({
        ...config,
        ...form,
      })
      setConnected(true)
      if (rootNavigationState?.key) router.replace(nextRouteAfterConnect(userToken))
    } catch (nextError) {
      setConnected(false)
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setTesting(false)
    }
  }

  if (loading && !config) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={palette.accent} />
      </View>
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: top + 16, paddingBottom: 28, gap: 18 }}
    >
      <SurfaceCard
        eyebrow="One nikcli account"
        title="Your CLI account, everywhere."
        description="Connect to the same Nikcli server, then sign in with the account already used by the local CLI, web app, and Studio."
        className="px-6 py-7"
      >
        <View className="absolute -right-10 -top-10 size-40 rounded-full bg-accent/15" />
        <View className="absolute bottom-0 left-0 h-24 w-full bg-panel/35" />
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label="Live sessions" tone="accent" />
          <InfoChip label="Repo switching" />
          <InfoChip label="Permission control" />
          <InfoChip label="PR publishing" />
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Account server"
        title="Connect to your server"
        description="Use the server that owns your CLI account. A pairing token is optional and remains available for unattended or legacy setups."
        tone="panel"
      >
        <View className="mb-4 flex-row items-center justify-between gap-4">
          <View>
            <Text className="text-sm font-semibold text-ink">Endpoint trust check</Text>
            <Text className="mt-1 text-xs leading-5 text-soft">
              The app validates the public user endpoint before opening the shared account login.
            </Text>
          </View>
          <ConnectionStatus connected={connected} label={connected ? "Online" : "Waiting"} />
        </View>

        <View className="gap-3">
          <TextField
            label="Server URL"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            placeholder="https://nikcli-mobile-production.up.railway.app"
          />
          <TextField
            label="Pairing token (optional)"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            placeholder="nkm_… fallback for automation"
          />
          <TextField
            label="Default server directory"
            value={directory}
            onChangeText={setDirectory}
            autoCapitalize="none"
            placeholder="Optional directory on the hosted server"
          />
          <ActionButton
            label="Validate and continue"
            loading={testing}
            disabled={!form.url}
            onPress={() => void connect()}
          />
        </View>
      </SurfaceCard>

      {error ? <ErrorBanner message={error} /> : null}

      <SurfaceCard
        eyebrow="Shared identity"
        title="One account, one server"
        description="The next screen calls /user/login on this server and stores the same nku_ session used by the CLI account. Pairing tokens are no longer required for a person signing in."
      >
        <Text className="font-mono text-sm leading-6 text-soft">
          nikcli mobile serve --hostname 0.0.0.0 --port $PORT --public-url
          https://nikcli-mobile-production.up.railway.app
        </Text>
        <Text className="mt-3 font-mono text-sm leading-6 text-soft">
          nikcli mobile pair --public-url https://nikcli-mobile-production.up.railway.app --name iphone --expiry-days 90
        </Text>
        <View className="mt-4 gap-2 rounded-[24px] border border-border bg-background/70 p-4">
          <Text className="text-[12px] font-medium text-muted">GitHub OAuth server setup</Text>
          <Text className="text-sm leading-6 text-soft">
            If Settings says GitHub OAuth is unavailable, add `NIKCLI_GITHUB_OAUTH_CLIENT_ID` or
            `GITHUB_CLIENT_ID_CONSOLE` to the hosted server environment, then restart that server process.
          </Text>
        </View>
      </SurfaceCard>
    </ScrollView>
  )
}
