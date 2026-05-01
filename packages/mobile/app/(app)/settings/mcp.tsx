import { useCallback, useMemo, useState } from "react"
import { ScrollView, Pressable, Text, View } from "react-native"
import * as WebBrowser from "expo-web-browser"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import { type HostConfigSnapshot, type HostMcpConfig, type HostMcpStatus } from "@/lib/types"

function optionChipClass(active: boolean) {
  return active ? "border-accent/30 bg-accent/12" : "border-border bg-background/70"
}

function optionChipTextClass(active: boolean) {
  return active ? "text-accent-light" : "text-ink"
}

function mcpTone(status?: HostMcpStatus): "accent" | "good" | "warn" | "neutral" {
  if (!status) return "neutral"
  if (status.status === "connected") return "good"
  if (status.status === "needs_auth" || status.status === "failed" || status.status === "needs_client_registration")
    return "warn"
  return "neutral"
}

function mcpLabel(status?: HostMcpStatus) {
  if (!status) return "Unknown"
  switch (status.status) {
    case "connected":
      return "Connected"
    case "disabled":
      return "Disabled"
    case "needs_auth":
      return "Needs auth"
    case "needs_client_registration":
      return "Needs registration"
    case "failed":
      return "Failed"
  }
}

export default function McpSettingsScreen() {
  const { client } = useServer()
  const [hostConfig, setHostConfig] = useState<HostConfigSnapshot | null>(null)
  const [mcpStatus, setMcpStatus] = useState<Record<string, HostMcpStatus>>({})
  const [mcpName, setMcpName] = useState("")
  const [mcpType, setMcpType] = useState<HostMcpConfig["type"]>("remote")
  const [mcpUrl, setMcpUrl] = useState("")
  const [mcpCommand, setMcpCommand] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      const [config, status] = await Promise.all([client.getConfig(), client.listMcpStatus()])
      setHostConfig(config)
      setMcpStatus(status)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const entries = useMemo(() => Object.entries(hostConfig?.mcp ?? {}), [hostConfig?.mcp])

  async function saveConfig(nextMcp: NonNullable<HostConfigSnapshot["mcp"]>, successMessage: string) {
    if (!client || !hostConfig) return
    try {
      setSaving(true)
      setMessage(null)
      const next = await client.updateConfig({ ...hostConfig, mcp: nextMcp })
      setHostConfig(next)
      await load()
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function addMcpServer() {
    if (!client) return
    const name = mcpName.trim()
    if (!name) return setMessage("MCP server name is required")
    if (mcpType === "remote" && !mcpUrl.trim()) return setMessage("Remote MCP URL is required")
    if (mcpType === "local" && !mcpCommand.trim()) return setMessage("Local MCP command is required")

    const nextMcp = { ...(hostConfig?.mcp ?? {}) }
    nextMcp[name] =
      mcpType === "remote"
        ? { type: "remote", url: mcpUrl.trim(), enabled: true }
        : { type: "local", command: mcpCommand.trim().split(/\s+/), enabled: true }

    await saveConfig(nextMcp, `Saved MCP server ${name}`)
    setMcpName("")
    setMcpUrl("")
    setMcpCommand("")
  }

  async function toggleMcpEnabled(name: string, enabled: boolean) {
    if (!hostConfig?.mcp?.[name]) return
    await saveConfig(
      { ...(hostConfig.mcp ?? {}), [name]: { ...hostConfig.mcp[name], enabled } },
      `${enabled ? "Enabled" : "Disabled"} ${name}`,
    )
  }

  async function connectMcp(name: string) {
    if (!client) return
    try {
      setSaving(true)
      await client.connectMcp(name)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function disconnectMcp(name: string) {
    if (!client) return
    try {
      setSaving(true)
      await client.disconnectMcp(name)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function authenticateMcp(name: string) {
    if (!client) return
    try {
      setSaving(true)
      const result = await client.startMcpAuth(name)
      await WebBrowser.openBrowserAsync(result.authorizationUrl)
      setMessage(`MCP auth opened for ${name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function clearMcpAuth(name: string) {
    if (!client) return
    try {
      setSaving(true)
      await client.removeMcpAuth(name)
      await load()
      setMessage(`Removed MCP auth for ${name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "MCP" }} />

      <SurfaceCard
        eyebrow="Model Context Protocol"
        title="Automation and capability endpoints"
        description="Register remote or local MCP servers, monitor connection state, and recover auth flows without leaving mobile."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${entries.length} configured`} tone={entries.length ? "accent" : "neutral"} />
          <InfoChip label={`${Object.keys(mcpStatus).length} live statuses`} />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      <SurfaceCard
        eyebrow="Add MCP server"
        title="Register a new endpoint"
        description="Create a remote URL-based MCP target or a host-local command endpoint."
      >
        <View className="gap-3">
          <TextField
            label="Server name"
            value={mcpName}
            onChangeText={setMcpName}
            autoCapitalize="none"
            placeholder="github-enterprise"
          />
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => setMcpType("remote")}
              className={`min-w-0 flex-1 rounded-[18px] border px-3 py-3 ${optionChipClass(mcpType === "remote")}`}
            >
              <Text className={`text-sm font-semibold ${optionChipTextClass(mcpType === "remote")}`}>Remote</Text>
              <Text className="mt-1 text-xs leading-5 text-soft">URL-based MCP endpoint</Text>
            </Pressable>
            <Pressable
              onPress={() => setMcpType("local")}
              className={`min-w-0 flex-1 rounded-[18px] border px-3 py-3 ${optionChipClass(mcpType === "local")}`}
            >
              <Text className={`text-sm font-semibold ${optionChipTextClass(mcpType === "local")}`}>Local</Text>
              <Text className="mt-1 text-xs leading-5 text-soft">Host command launched by Nikcli</Text>
            </Pressable>
          </View>
          {mcpType === "remote" ? (
            <TextField
              label="Remote URL"
              value={mcpUrl}
              onChangeText={setMcpUrl}
              autoCapitalize="none"
              placeholder="https://mcp.example.com"
            />
          ) : (
            <TextField
              label="Local command"
              value={mcpCommand}
              onChangeText={setMcpCommand}
              autoCapitalize="none"
              placeholder="bunx @modelcontextprotocol/server-github"
            />
          )}
          <ActionButton label="Save MCP server" loading={saving} onPress={() => void addMcpServer()} />
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Configured servers"
        title="Live status and auth"
        description="Inspect host MCP endpoints and take focused actions per integration."
      >
        {loading ? (
          <View className="items-center rounded-[8px] border border-border bg-background/60 px-4 py-5">
            <Text className="text-sm text-soft">Loading MCP control plane…</Text>
          </View>
        ) : (
          <View className="gap-3">
            {entries.length ? (
              entries.map(([name, entry]) => {
                const status = mcpStatus[name]
                const enabled = entry.enabled !== false
                return (
                  <View key={name} className="rounded-[8px] border border-border bg-background/60 px-4 py-4">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-base font-semibold text-ink">{name}</Text>
                      <InfoChip label={entry.type} tone="accent" />
                      <InfoChip label={mcpLabel(status)} tone={mcpTone(status)} />
                      <InfoChip label={enabled ? "Enabled" : "Disabled"} />
                    </View>
                    <Text selectable className="mt-2 text-sm leading-5 text-soft">
                      {entry.type === "remote" ? entry.url : entry.command.join(" ")}
                    </Text>
                    {status && "error" in status ? (
                      <Text className="mt-2 text-xs leading-5 text-soft">{status.error}</Text>
                    ) : null}
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      <ActionButton
                        label={enabled ? "Disable" : "Enable"}
                        variant="secondary"
                        loading={saving}
                        onPress={() => void toggleMcpEnabled(name, !enabled)}
                      />
                      <ActionButton
                        label="Connect"
                        variant="ghost"
                        loading={saving}
                        onPress={() => void connectMcp(name)}
                      />
                      <ActionButton
                        label="Disconnect"
                        variant="ghost"
                        loading={saving}
                        onPress={() => void disconnectMcp(name)}
                      />
                      {status?.status === "needs_auth" ? (
                        <ActionButton
                          label="Auth"
                          variant="secondary"
                          loading={saving}
                          onPress={() => void authenticateMcp(name)}
                        />
                      ) : null}
                      {status?.status === "connected" || status?.status === "needs_auth" ? (
                        <ActionButton
                          label="Clear auth"
                          variant="secondary"
                          loading={saving}
                          onPress={() => void clearMcpAuth(name)}
                        />
                      ) : null}
                    </View>
                  </View>
                )
              })
            ) : (
              <View className="rounded-[8px] border border-border bg-background/60 px-4 py-4">
                <Text className="text-sm leading-6 text-soft">No MCP servers configured on this host yet.</Text>
              </View>
            )}
          </View>
        )}
      </SurfaceCard>
    </ScrollView>
  )
}
