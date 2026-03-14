import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { ConnectionStatus } from "@/components/ConnectionStatus"
import { useServer } from "@/lib/server-provider"
import type { ServerConfig } from "@/lib/types"
import { MobileClient } from "@/lib/client"

function fromLink(url: string): ServerConfig | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "nikcli:") return null
    if (parsed.hostname !== "connect") return null
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
  const { config, loading, save } = useServer()
  const [url, setUrl] = useState(config?.url ?? "")
  const [token, setToken] = useState(config?.token ?? "")
  const [directory, setDirectory] = useState(config?.directory ?? "")
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (loading) return
    if (config) {
      setUrl(config.url)
      setToken(config.token ?? "")
      setDirectory(config.directory ?? "")
      // Auto-connect if we already have a saved/env config
      const c = new MobileClient(config)
      c.ping().then((ok) => {
        if (ok) {
          setConnected(true)
          router.replace("/sessions")
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  useEffect(() => {
    Linking.getInitialURL().then((value) => {
      if (!value) return
      const parsed = fromLink(value)
      if (!parsed) return
      setUrl(parsed.url)
      setToken(parsed.token ?? "")
      setDirectory(parsed.directory ?? "")
    })

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const parsed = fromLink(url)
      if (!parsed) return
      setUrl(parsed.url)
      setToken(parsed.token ?? "")
      setDirectory(parsed.directory ?? "")
    })

    return () => subscription.remove()
  }, [])

  const form = useMemo(
    () => ({ url: url.trim(), token: token.trim() || undefined, directory: directory.trim() || undefined }),
    [directory, token, url],
  )

  async function connect() {
    try {
      setTesting(true)
      setError(null)
      const client = new MobileClient(form)
      await client.bootstrap()
      await save(form)
      setConnected(true)
      router.replace("/sessions")
    } catch (error) {
      setConnected(false)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 18, paddingBottom: 28 }}
    >
      <View className="overflow-hidden rounded-[34px] border border-border bg-surface px-6 py-7">
        <View className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/15" />
        <View className="absolute bottom-0 left-0 h-24 w-full bg-panel/35" />
        <Text className="text-[11px] font-semibold uppercase tracking-[2.6px] text-accent-light">
          Nikcli Mobile Control
        </Text>
        <Text className="mt-4 text-[34px] font-semibold leading-[40px] text-ink">
          Enterprise command access for your active workspace.
        </Text>
        <Text className="mt-4 text-base leading-7 text-soft">
          Pair this app with a Nikcli host running on your Mac, VPS, or container, then chat, review diffs, and drive
          sandbox worktrees from your phone.
        </Text>
        <View className="mt-6 flex-row flex-wrap gap-2">
          <View className="rounded-full bg-background/80 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">Live sessions</Text>
          </View>
          <View className="rounded-full bg-background/80 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">Repo switching</Text>
          </View>
          <View className="rounded-full bg-background/80 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">Permission control</Text>
          </View>
        </View>
      </View>

      <View className="rounded-[30px] border border-border bg-panel px-5 py-5">
        <View className="mb-4 flex-row items-center justify-between gap-4">
          <View>
            <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Secure pairing</Text>
            <Text className="mt-1 text-xl font-semibold text-ink">Connect to your host</Text>
          </View>
          <ConnectionStatus connected={connected} label={connected ? "Online" : "Waiting"} />
        </View>

        <View className="gap-3">
          <View>
            <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[1.8px] text-soft">Host URL</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              placeholder="https://your-host.example.com"
              placeholderTextColor="#6d84a0"
              className="rounded-3xl border border-border bg-background px-4 py-4 text-base text-ink"
            />
          </View>
          <View>
            <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[1.8px] text-soft">Bearer token</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              placeholder="Bearer token from nikcli mobile pair"
              placeholderTextColor="#6d84a0"
              className="rounded-3xl border border-border bg-background px-4 py-4 text-base text-ink"
            />
          </View>
          <View>
            <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[1.8px] text-soft">
              Default directory
            </Text>
            <TextInput
              value={directory}
              onChangeText={setDirectory}
              autoCapitalize="none"
              placeholder="Optional default directory on host"
              placeholderTextColor="#6d84a0"
              className="rounded-3xl border border-border bg-background px-4 py-4 text-base text-ink"
            />
          </View>
          <Pressable
            disabled={testing || !form.url}
            onPress={() => void connect()}
            className="mt-1 rounded-3xl bg-accent px-4 py-4"
          >
            {testing ? (
              <ActivityIndicator color="#082f49" />
            ) : (
              <Text className="text-center text-base font-semibold text-slate-950">Validate and continue</Text>
            )}
          </Pressable>
        </View>
      </View>

      {error ? (
        <View className="rounded-3xl border border-danger/40 bg-danger/10 px-4 py-4">
          <Text className="text-sm leading-6 text-rose-200">{error}</Text>
        </View>
      ) : null}

      <View className="rounded-[30px] border border-border bg-surface px-5 py-5">
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Quick host setup</Text>
        <Text className="mt-2 text-lg font-semibold text-ink">Start a mobile-ready endpoint</Text>
        <Text className="mt-3 font-mono text-sm leading-6 text-soft">
          nikcli mobile serve --hostname 0.0.0.0 --port 4096 --pair --public-url https://your-host.example.com
        </Text>
        <Text className="mt-3 text-sm leading-6 text-soft">
          Use a public HTTPS URL, then scan or open the `nikcli://connect` pairing link on your phone.
        </Text>
      </View>
    </ScrollView>
  )
}
