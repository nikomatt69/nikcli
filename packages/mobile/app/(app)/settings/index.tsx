import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { useServer } from "@/lib/server-provider"

export default function SettingsScreen() {
  const { client, config, save, clear } = useServer()
  const [url, setUrl] = useState(config?.url ?? "")
  const [token, setToken] = useState(config?.token ?? "")
  const [directory, setDirectory] = useState(config?.directory ?? "")
  const [githubToken, setGithubToken] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setUrl(config?.url ?? "")
    setToken(config?.token ?? "")
    setDirectory(config?.directory ?? "")
  }, [config])

  useFocusEffect(
    useCallback(() => {
      setMessage(null)
    }, []),
  )

  async function saveConnection() {
    try {
      setSaving(true)
      await save({ url: url.trim(), token: token.trim() || undefined, directory: directory.trim() || undefined })
      setMessage("Connection saved")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function connectGithub() {
    if (!client || !githubToken.trim()) return
    try {
      setSaving(true)
      await client.setGithubToken(githubToken.trim())
      setGithubToken("")
      setMessage("GitHub token saved on host")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function disconnectGithub() {
    if (!client) return
    try {
      setSaving(true)
      await client.clearGithubToken()
      setMessage("GitHub token removed")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}>
      <View className="overflow-hidden rounded-[32px] border border-border bg-surface px-5 py-5">
        <View className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/15" />
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
          Operations settings
        </Text>
        <Text className="mt-2 text-[30px] font-semibold leading-[34px] text-ink">
          Control host access and GitHub credentials.
        </Text>
        <Text className="mt-3 text-sm leading-6 text-soft">
          Manage how your phone authenticates to the Nikcli host and which GitHub account the host can use.
        </Text>
      </View>

      <View className="rounded-[32px] border border-border bg-panel px-4 py-4">
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Host connection</Text>
        <Text className="mt-2 text-lg font-semibold text-ink">Primary endpoint</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          placeholder="https://your-host.example.com"
          placeholderTextColor="#6d84a0"
          className="mt-4 rounded-2xl border border-border bg-background px-4 py-4 text-base text-ink"
        />
        <TextInput
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          placeholder="Bearer token"
          placeholderTextColor="#6d84a0"
          className="mt-3 rounded-2xl border border-border bg-background px-4 py-4 text-base text-ink"
        />
        <TextInput
          value={directory}
          onChangeText={setDirectory}
          autoCapitalize="none"
          placeholder="Default host directory"
          placeholderTextColor="#6d84a0"
          className="mt-3 rounded-2xl border border-border bg-background px-4 py-4 text-base text-ink"
        />
        <Pressable
          disabled={saving}
          onPress={() => void saveConnection()}
          className="mt-4 rounded-2xl bg-accent px-4 py-4"
        >
          {saving ? (
            <ActivityIndicator color="#082f49" />
          ) : (
            <Text className="text-center font-semibold text-slate-950">Save connection</Text>
          )}
        </Pressable>
        <Pressable
          disabled={saving}
          onPress={() => void clear()}
          className="mt-3 rounded-2xl border border-border bg-background/70 px-4 py-4"
        >
          <Text className="text-center font-semibold text-ink">Forget host</Text>
        </Pressable>
      </View>

      <View className="rounded-[32px] border border-border bg-surface px-4 py-4">
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">GitHub on host</Text>
        <Text className="mt-2 text-lg font-semibold text-ink">Repository access</Text>
        <Text className="mt-2 text-sm leading-6 text-soft">
          For now, save a GitHub token directly to the Nikcli host so mobile repo browsing can work outside the tailnet
          too.
        </Text>
        <TextInput
          value={githubToken}
          onChangeText={setGithubToken}
          autoCapitalize="none"
          placeholder="ghp_..."
          placeholderTextColor="#6d84a0"
          className="mt-4 rounded-2xl border border-border bg-background px-4 py-4 text-base text-ink"
        />
        <Pressable
          disabled={saving || !githubToken.trim()}
          onPress={() => void connectGithub()}
          className="mt-3 rounded-2xl bg-accent px-4 py-4"
        >
          <Text className="text-center font-semibold text-slate-950">Save GitHub token</Text>
        </Pressable>
        <Pressable
          disabled={saving}
          onPress={() => void disconnectGithub()}
          className="mt-3 rounded-2xl border border-border bg-background/70 px-4 py-4"
        >
          <Text className="text-center font-semibold text-ink">Remove GitHub token</Text>
        </Pressable>
      </View>

      {message ? <Text className="text-sm text-soft">{message}</Text> : null}
    </ScrollView>
  )
}
