import { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native"
import * as WebBrowser from "expo-web-browser"
import { Stack, useFocusEffect } from "expo-router"
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Globe,
  Key,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Unplug,
  Wifi,
  WifiOff,
} from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { type HostConfigSnapshot, type HostMcpConfig, type HostMcpStatus } from "@/lib/types"

function mcpStatusColors(status?: HostMcpStatus): { dot: string; label: string } {
  if (!status) return { dot: "#8E8E93", label: "Unknown" }
  switch (status.status) {
    case "connected": return { dot: "#34C759", label: "Connected" }
    case "disabled": return { dot: "#8E8E93", label: "Disabled" }
    case "needs_auth": return { dot: "#FF9500", label: "Needs auth" }
    case "needs_client_registration": return { dot: "#FF9500", label: "Needs registration" }
    case "failed": return { dot: "#FF3B30", label: "Failed" }
  }
}

type McpServerCardProps = {
  name: string
  entry: HostMcpConfig
  status: HostMcpStatus | undefined
  saving: boolean
  onToggle(enabled: boolean): void
  onConnect(): void
  onDisconnect(): void
  onAuth(): void
  onClearAuth(): void
  onDelete(): void
}

function McpServerCard({ name, entry, status, saving, onToggle, onConnect, onDisconnect, onAuth, onClearAuth, onDelete }: McpServerCardProps) {
  const { palette, isDark } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const { dot, label: statusLabel } = mcpStatusColors(status)
  const enabled = entry.enabled !== false
  const isRemote = entry.type === "remote"
  const isConnected = status?.status === "connected"
  const needsAuth = status?.status === "needs_auth"

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.surface,
          borderColor: isConnected ? "rgba(52,199,89,0.30)" : palette.border,
          shadowColor: palette.shadow,
        },
      ]}
    >
      <Pressable
        onPress={() => {
          void triggerHaptic("selection")
          setExpanded((v) => !v)
        }}
        style={styles.cardHeader}
      >
        <View style={[styles.iconWrap, { backgroundColor: isRemote ? (isDark ? "rgba(255,255,255,0.07)" : "rgba(14,165,233,0.07)") : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)") }]}>
          {isRemote
            ? <Globe size={18} color={isConnected ? "#34C759" : palette.accentLight} strokeWidth={1.8} />
            : <Terminal size={18} color={isConnected ? "#34C759" : palette.soft} strokeWidth={1.8} />}
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>
            {name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            <View style={[styles.statusDot, { backgroundColor: dot }]} />
            <Text style={{ fontSize: 12, fontWeight: "500", color: palette.muted }}>{statusLabel}</Text>
            <Text style={{ fontSize: 11, color: palette.muted }}>· {entry.type}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Switch
            value={enabled}
            onValueChange={(val) => {
              void triggerHaptic("selection")
              onToggle(val)
            }}
            trackColor={{ false: palette.border, true: palette.accent }}
            thumbColor="#ffffff"
          />
          {expanded
            ? <ChevronUp size={15} color={palette.muted} strokeWidth={2} />
            : <ChevronDown size={15} color={palette.muted} strokeWidth={2} />}
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.expandBody}>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginBottom: 12 }} />

          {/* Endpoint */}
          <View style={[styles.endpointRow, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", borderColor: palette.border }]}>
            {isRemote
              ? <Globe size={12} color={palette.muted} strokeWidth={2} />
              : <Terminal size={12} color={palette.muted} strokeWidth={2} />}
            <Text style={{ flex: 1, fontSize: 12, fontFamily: "monospace", lineHeight: 17, color: palette.soft }} numberOfLines={2} selectable>
              {isRemote ? entry.url : entry.command.join(" ")}
            </Text>
          </View>

          {/* Error */}
          {status && "error" in status && status.error ? (
            <View style={[styles.errorRow, { backgroundColor: isDark ? "rgba(255,59,48,0.10)" : "rgba(255,59,48,0.07)", borderColor: "rgba(255,59,48,0.22)", marginTop: 10 }]}>
              <AlertCircle size={12} color="#FF3B30" strokeWidth={2} />
              <Text style={{ fontSize: 12, color: "#FF3B30", flex: 1, lineHeight: 18 }}>{status.error}</Text>
            </View>
          ) : null}

          {/* Actions */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {!isConnected ? (
              <Pressable
                onPress={() => { void triggerHaptic("send"); onConnect() }}
                disabled={saving}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: "rgba(52,199,89,0.10)", borderColor: "rgba(52,199,89,0.25)", opacity: saving ? 0.5 : pressed ? 0.7 : 1 }]}
              >
                <Play size={13} color="#34C759" strokeWidth={2} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#34C759" }}>Connect</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => { void triggerHaptic("selection"); onDisconnect() }}
                disabled={saving}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: palette.border, opacity: saving ? 0.5 : pressed ? 0.7 : 1 }]}
              >
                <Unplug size={13} color={palette.soft} strokeWidth={2} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: palette.soft }}>Disconnect</Text>
              </Pressable>
            )}

            {needsAuth ? (
              <Pressable
                onPress={() => { void triggerHaptic("send"); onAuth() }}
                disabled={saving}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: "rgba(255,149,0,0.10)", borderColor: "rgba(255,149,0,0.25)", opacity: saving ? 0.5 : pressed ? 0.7 : 1 }]}
              >
                <Key size={13} color="#FF9500" strokeWidth={2} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#FF9500" }}>Authenticate</Text>
              </Pressable>
            ) : null}

            {(isConnected || needsAuth) ? (
              <Pressable
                onPress={() => { void triggerHaptic("error"); onClearAuth() }}
                disabled={saving}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: palette.border, opacity: saving ? 0.5 : pressed ? 0.7 : 1 }]}
              >
                <LogOut size={13} color={palette.soft} strokeWidth={2} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: palette.soft }}>Clear auth</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => { void triggerHaptic("error"); onDelete() }}
              disabled={saving}
              style={({ pressed }) => [styles.actionBtn, { backgroundColor: isDark ? "rgba(255,59,48,0.10)" : "rgba(255,59,48,0.07)", borderColor: "rgba(255,59,48,0.22)", opacity: saving ? 0.5 : pressed ? 0.7 : 1 }]}
            >
              <Trash2 size={13} color="#FF3B30" strokeWidth={2} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#FF3B30" }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export default function McpSettingsScreen() {
  const { client } = useServer()
  const { palette, isDark } = useAppTheme()
  const { bottom } = useSafeAreaInsets()
  const [hostConfig, setHostConfig] = useState<HostConfigSnapshot | null>(null)
  const [mcpStatus, setMcpStatus] = useState<Record<string, HostMcpStatus>>({})
  const [mcpName, setMcpName] = useState("")
  const [mcpType, setMcpType] = useState<HostMcpConfig["type"]>("remote")
  const [mcpUrl, setMcpUrl] = useState("")
  const [mcpCommand, setMcpCommand] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const entries = useMemo(() => Object.entries(hostConfig?.mcp ?? {}), [hostConfig?.mcp])
  const connectedCount = Object.values(mcpStatus).filter((s) => s.status === "connected").length

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
    if (!name) return setMessage("Server name is required")
    if (mcpType === "remote" && !mcpUrl.trim()) return setMessage("Remote URL is required")
    if (mcpType === "local" && !mcpCommand.trim()) return setMessage("Local command is required")

    const nextMcp = { ...(hostConfig?.mcp ?? {}) }
    nextMcp[name] =
      mcpType === "remote"
        ? { type: "remote", url: mcpUrl.trim(), enabled: true }
        : { type: "local", command: mcpCommand.trim().split(/\s+/), enabled: true }

    await saveConfig(nextMcp, `Added ${name}`)
    setMcpName("")
    setMcpUrl("")
    setMcpCommand("")
    setAddOpen(false)
    void triggerHaptic("success")
  }

  async function deleteMcpServer(name: string) {
    if (!hostConfig?.mcp) return
    const nextMcp = { ...hostConfig.mcp }
    delete nextMcp[name]
    await saveConfig(nextMcp, `Removed ${name}`)
    void triggerHaptic("error")
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
      setMessage(`Cleared auth for ${name}`)
      void triggerHaptic("success")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(bottom, 32) + 16, gap: 10 }}
    >
      <Stack.Screen options={{ title: "MCP Servers" }} />

      {/* Header */}
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow, flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }]}>
        <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(14,165,233,0.07)" }]}>
          <Server size={20} color={palette.accentLight} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: palette.ink, letterSpacing: -0.2 }}>Model Context Protocol</Text>
          <Text style={{ fontSize: 12, lineHeight: 17, color: palette.muted, marginTop: 2 }}>
            Register remote or local MCP servers and manage their lifecycle from mobile.
          </Text>
        </View>
        <Pressable
          onPress={() => { void triggerHaptic("selection"); void load() }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {loading
            ? <ActivityIndicator size="small" color={palette.accent} />
            : <RefreshCw size={16} color={palette.muted} strokeWidth={2} />}
        </Pressable>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={[styles.statPill, { backgroundColor: "rgba(52,199,89,0.10)", borderColor: "rgba(52,199,89,0.22)" }]}>
          <Wifi size={13} color="#34C759" strokeWidth={2} />
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#34C759" }}>{connectedCount} live</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: palette.border }]}>
          <Server size={13} color={palette.muted} strokeWidth={2} />
          <Text style={{ fontSize: 12, fontWeight: "600", color: palette.muted }}>{entries.length} configured</Text>
        </View>
      </View>

      {/* Error banner */}
      {message ? (
        <View style={[styles.errorRow, { backgroundColor: isDark ? "rgba(255,59,48,0.10)" : "rgba(255,59,48,0.07)", borderColor: "rgba(255,59,48,0.22)" }]}>
          <AlertCircle size={14} color="#FF3B30" strokeWidth={2} />
          <Text style={{ fontSize: 13, color: "#FF3B30", flex: 1, lineHeight: 18 }}>{message}</Text>
        </View>
      ) : null}

      {/* Server list */}
      {entries.length > 0 ? (
        <>
          <Text style={[styles.sectionLabel, { color: palette.muted }]}>Registered servers</Text>
          {entries.map(([name, entry]) => (
            <McpServerCard
              key={name}
              name={name}
              entry={entry}
              status={mcpStatus[name]}
              saving={saving}
              onToggle={(enabled) => void toggleMcpEnabled(name, enabled)}
              onConnect={() => void connectMcp(name)}
              onDisconnect={() => void disconnectMcp(name)}
              onAuth={() => void authenticateMcp(name)}
              onClearAuth={() => void clearMcpAuth(name)}
              onDelete={() => void deleteMcpServer(name)}
            />
          ))}
        </>
      ) : !loading ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow, padding: 20, alignItems: "center", gap: 10 }]}>
          <WifiOff size={26} color={palette.muted} strokeWidth={1.6} />
          <Text style={{ fontSize: 14, color: palette.muted, textAlign: "center", lineHeight: 20 }}>
            No MCP servers configured yet. Add one below.
          </Text>
        </View>
      ) : null}

      {/* Add server */}
      <Text style={[styles.sectionLabel, { color: palette.muted, marginTop: 6 }]}>Add server</Text>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow }]}>
        <Pressable
          onPress={() => { void triggerHaptic("selection"); setAddOpen((v) => !v) }}
          style={styles.cardHeader}
        >
          <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(14,165,233,0.07)" }]}>
            <Plus size={18} color={palette.accentLight} strokeWidth={2} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink, flex: 1, letterSpacing: -0.2 }}>
            Register a new endpoint
          </Text>
          {addOpen
            ? <ChevronUp size={15} color={palette.muted} strokeWidth={2} />
            : <ChevronDown size={15} color={palette.muted} strokeWidth={2} />}
        </Pressable>

        {addOpen ? (
          <View style={[styles.expandBody, { gap: 12 }]}>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginBottom: 2 }} />

            {/* Name */}
            <View style={{ gap: 6 }}>
              <Text style={[styles.inputLabel, { color: palette.muted }]}>Server name</Text>
              <View style={[styles.inputWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", borderColor: palette.border }]}>
                <TextInput
                  value={mcpName}
                  onChangeText={setMcpName}
                  placeholder="github-enterprise"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ fontSize: 14, color: palette.ink }}
                />
              </View>
            </View>

            {/* Type */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["remote", "local"] as const).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setMcpType(type)}
                  style={[
                    styles.typeBtn,
                    {
                      flex: 1,
                      backgroundColor: mcpType === type ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.08)") : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"),
                      borderColor: mcpType === type ? (isDark ? "rgba(255,255,255,0.18)" : "rgba(14,165,233,0.22)") : palette.border,
                    },
                  ]}
                >
                  {type === "remote"
                    ? <Globe size={14} color={mcpType === type ? palette.accentLight : palette.muted} strokeWidth={2} />
                    : <Terminal size={14} color={mcpType === type ? palette.accentLight : palette.muted} strokeWidth={2} />}
                  <Text style={{ fontSize: 13, fontWeight: "600", color: mcpType === type ? palette.accentLight : palette.muted }}>
                    {type === "remote" ? "Remote" : "Local"}
                  </Text>
                  <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }}>
                    {type === "remote" ? "URL endpoint" : "Host command"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* URL / command */}
            <View style={{ gap: 6 }}>
              <Text style={[styles.inputLabel, { color: palette.muted }]}>
                {mcpType === "remote" ? "Remote URL" : "Command"}
              </Text>
              <View style={[styles.inputWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", borderColor: palette.border }]}>
                <TextInput
                  value={mcpType === "remote" ? mcpUrl : mcpCommand}
                  onChangeText={mcpType === "remote" ? setMcpUrl : setMcpCommand}
                  placeholder={mcpType === "remote" ? "https://mcp.example.com" : "bunx @modelcontextprotocol/server-github"}
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={mcpType === "remote" ? "url" : "default"}
                  style={{ fontSize: 14, color: palette.ink, fontFamily: mcpType === "remote" ? "monospace" : undefined }}
                />
              </View>
            </View>

            {/* Save button */}
            <Pressable
              onPress={() => void addMcpServer()}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                {
                  backgroundColor: isDark ? "rgba(255,255,255,0.90)" : palette.accent,
                  opacity: saving ? 0.55 : pressed ? 0.78 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#fff"} />
              ) : (
                <>
                  <Plus size={15} color={isDark ? "#0a0a0a" : "#fff"} strokeWidth={2.4} />
                  <Text style={{ fontSize: 14, fontWeight: "700", color: isDark ? "#0a0a0a" : "#fff" }}>
                    Add server
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  expandBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  endpointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  inputWrap: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  typeBtn: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
})
