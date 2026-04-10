import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import * as WebBrowser from "expo-web-browser"
import { Stack, useFocusEffect } from "expo-router"
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Figma,
  Link2,
  MessageSquare,
  BarChart2,
  Zap,
  Star,
  Plug,
  RefreshCw,
  Trash2,
  Smartphone,
} from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { type ConnectorStatus } from "@/lib/types"

type ConnectorDef = {
  name: string
  label: string
  description: string
  credentialType: "token" | "botToken" | "apiKey"
  credentialLabel: string
  placeholder: string
  docsUrl?: string
  featured?: boolean
}

type MobileAppLink = {
  id: string
  label: string
  description: string
  urlScheme: string
  deepLinks: Array<{ label: string; url: string }>
  storeUrl?: string
}

const KNOWN_CONNECTORS: ConnectorDef[] = [
  {
    name: "figma",
    label: "Figma",
    description: "Access design files, components, and variables. Enable AI-assisted design-to-code workflows.",
    credentialType: "apiKey",
    credentialLabel: "Personal Access Token",
    placeholder: "figd_...",
    docsUrl: "https://www.figma.com/developers/api#access-tokens",
    featured: true,
  },
  {
    name: "slack",
    label: "Slack",
    description: "Read and send messages, manage channels, and integrate Slack into AI workflows.",
    credentialType: "botToken",
    credentialLabel: "Bot Token",
    placeholder: "xoxb-...",
    featured: true,
  },
  {
    name: "linear",
    label: "Linear",
    description: "Create and track issues, sync project state, and automate engineering workflows.",
    credentialType: "apiKey",
    credentialLabel: "API Key",
    placeholder: "lin_api_...",
    featured: true,
  },
  {
    name: "discord",
    label: "Discord",
    description: "Bot integrations for community notifications and AI-driven server automation.",
    credentialType: "botToken",
    credentialLabel: "Bot Token",
    placeholder: "Bot token",
  },
  {
    name: "teams",
    label: "Microsoft Teams",
    description: "Enterprise messaging and meeting integrations via Microsoft Graph.",
    credentialType: "token",
    credentialLabel: "Access Token",
    placeholder: "Bearer token",
  },
  {
    name: "lovable",
    label: "Lovable",
    description: "Connect AI-generated apps and sync Lovable project context.",
    credentialType: "apiKey",
    credentialLabel: "API Key",
    placeholder: "API key",
  },
  {
    name: "gchat",
    label: "Google Chat",
    description: "Workspace chat integration for notifications and AI assistant responses.",
    credentialType: "token",
    credentialLabel: "OAuth Token",
    placeholder: "OAuth token",
  },
]

const MOBILE_APP_LINKS: MobileAppLink[] = [
  {
    id: "figma",
    label: "Figma",
    description: "Open design files and components directly in the Figma iOS app.",
    urlScheme: "figma://",
    deepLinks: [
      { label: "Open Figma app", url: "figma://" },
      { label: "Browse recent files", url: "figma://recent" },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    description: "Jump to Slack workspace channels and DMs.",
    urlScheme: "slack://",
    deepLinks: [
      { label: "Open Slack", url: "slack://" },
      { label: "Open DMs", url: "slack://open?team=" },
    ],
  },
  {
    id: "linear",
    label: "Linear",
    description: "Open issues and project boards in the Linear app.",
    urlScheme: "linear://",
    deepLinks: [
      { label: "Open Linear", url: "linear://" },
      { label: "My issues", url: "linear://my-issues" },
    ],
  },
  {
    id: "github",
    label: "GitHub",
    description: "Open repositories, issues and pull requests in the GitHub app.",
    urlScheme: "github://",
    deepLinks: [
      { label: "Open GitHub", url: "github://" },
      { label: "Notifications", url: "github://notifications" },
    ],
  },
  {
    id: "notion",
    label: "Notion",
    description: "Navigate to pages and databases in the Notion app.",
    urlScheme: "notion://",
    deepLinks: [
      { label: "Open Notion", url: "notion://" },
    ],
  },
]

function ConnectorIcon({ name, size, color }: { name: string; size: number; color: string }) {
  switch (name) {
    case "figma": return <Figma size={size} color={color} strokeWidth={1.8} />
    case "slack": return <MessageSquare size={size} color={color} strokeWidth={1.8} />
    case "linear": return <BarChart2 size={size} color={color} strokeWidth={1.8} />
    case "discord": return <Zap size={size} color={color} strokeWidth={1.8} />
    case "lovable": return <Star size={size} color={color} strokeWidth={1.8} />
    default: return <Link2 size={size} color={color} strokeWidth={1.8} />
  }
}

function statusToneColors(status?: ConnectorStatus, isDark?: boolean): { dot: string; label: string } {
  if (!status || status.status === "disabled") return { dot: "#8E8E93", label: "Not configured" }
  if (status.status === "connected") return { dot: "#34C759", label: "Connected" }
  return { dot: "#FF9500", label: status.status === "needs_auth" ? "Needs auth" : "Failed" }
}

type ConnectorCardProps = {
  connector: ConnectorDef
  status: ConnectorStatus | undefined
  credential: string
  saving: boolean
  onCredentialChange(value: string): void
  onSave(): void
  onRemove(): void
  onDocsOpen(): void
}

function ConnectorCard({
  connector,
  status,
  credential,
  saving,
  onCredentialChange,
  onSave,
  onRemove,
  onDocsOpen,
}: ConnectorCardProps) {
  const { palette, isDark } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const { dot, label: statusLabel } = statusToneColors(status, isDark)
  const isConnected = status?.status === "connected"
  const hasCred = credential.trim().length > 0
  const canRemove = status?.status !== "disabled"

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.surface,
          borderColor: isConnected
            ? isDark ? "rgba(52,199,89,0.28)" : "rgba(52,199,89,0.32)"
            : palette.border,
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
        <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)" }]}>
          <ConnectorIcon name={connector.name} size={20} color={isConnected ? "#34C759" : palette.soft} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink, letterSpacing: -0.2 }}>
              {connector.label}
            </Text>
            {connector.featured ? (
              <View style={[styles.badge, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(14,165,233,0.07)", borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(14,165,233,0.15)" }]}>
                <Text style={{ fontSize: 10, fontWeight: "600", color: isDark ? palette.accentLight : palette.accentLight }}>Featured</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={{ fontSize: 12, fontWeight: "500", color: palette.muted }}>{statusLabel}</Text>
          </View>
        </View>

        {expanded
          ? <ChevronUp size={16} color={palette.muted} strokeWidth={2} />
          : <ChevronDown size={16} color={palette.muted} strokeWidth={2} />}
      </Pressable>

      {expanded ? (
        <View style={styles.expandBody}>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginBottom: 14 }} />

          <Text style={{ fontSize: 13, lineHeight: 19, color: palette.soft }}>{connector.description}</Text>

          {status?.status === "failed" && "error" in status ? (
            <View style={[styles.errorRow, { backgroundColor: isDark ? "rgba(255,59,48,0.10)" : "rgba(255,59,48,0.07)", borderColor: "rgba(255,59,48,0.20)" }]}>
              <AlertCircle size={13} color="#FF3B30" strokeWidth={2} />
              <Text style={{ fontSize: 12, color: "#FF3B30", flex: 1, lineHeight: 18 }}>{status.error}</Text>
            </View>
          ) : null}

          <View style={{ gap: 6, marginTop: 12 }}>
            <Text style={styles.inputLabel}>{connector.credentialLabel}</Text>
            <View style={[styles.inputWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", borderColor: palette.border }]}>
              <TextInput
                value={credential}
                onChangeText={onCredentialChange}
                placeholder={connector.placeholder}
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={{ fontSize: 14, color: palette.ink, fontFamily: "monospace" }}
              />
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
            <Pressable
              onPress={() => { void triggerHaptic("send"); onSave() }}
              disabled={saving || !hasCred}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  flex: 1,
                  backgroundColor: hasCred
                    ? isDark ? "rgba(255,255,255,0.90)" : palette.accent
                    : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                  borderColor: hasCred
                    ? isDark ? "rgba(255,255,255,0.18)" : "rgba(14,165,233,0.18)"
                    : palette.border,
                  opacity: (saving || !hasCred) ? 0.5 : pressed ? 0.78 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={hasCred ? (isDark ? "#0a0a0a" : "#fff") : palette.muted} />
              ) : (
                <Text style={{ fontSize: 14, fontWeight: "600", color: hasCred ? (isDark ? "#0a0a0a" : "#fff") : palette.muted }}>
                  Save credentials
                </Text>
              )}
            </Pressable>

            {canRemove ? (
              <Pressable
                onPress={() => { void triggerHaptic("error"); onRemove() }}
                disabled={saving}
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    paddingHorizontal: 14,
                    backgroundColor: isDark ? "rgba(255,59,48,0.10)" : "rgba(255,59,48,0.07)",
                    borderColor: "rgba(255,59,48,0.22)",
                    opacity: saving ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Trash2 size={15} color="#FF3B30" strokeWidth={2} />
              </Pressable>
            ) : null}

            {connector.docsUrl ? (
              <Pressable
                onPress={() => { void triggerHaptic("selection"); onDocsOpen() }}
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    paddingHorizontal: 14,
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    borderColor: palette.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <ExternalLink size={15} color={palette.soft} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function MobileAppCard({ app }: { app: MobileAppLink }) {
  const { palette, isDark } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)

  async function checkAvailable() {
    try {
      const canOpen = await Linking.canOpenURL(app.urlScheme)
      setAvailable(canOpen)
    } catch {
      setAvailable(false)
    }
  }

  async function openDeepLink(url: string) {
    try {
      void triggerHaptic("send")
      await Linking.openURL(url)
    } catch {
      void triggerHaptic("error")
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow }]}>
      <Pressable
        onPress={async () => {
          void triggerHaptic("selection")
          if (!expanded) await checkAvailable()
          setExpanded((v) => !v)
        }}
        style={styles.cardHeader}
      >
        <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)" }]}>
          <Smartphone size={18} color={palette.soft} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink, letterSpacing: -0.2 }}>{app.label}</Text>
          <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}>{app.description}</Text>
        </View>
        {expanded
          ? <ChevronUp size={16} color={palette.muted} strokeWidth={2} />
          : <ChevronDown size={16} color={palette.muted} strokeWidth={2} />}
      </Pressable>

      {expanded ? (
        <View style={styles.expandBody}>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginBottom: 12 }} />

          {available !== null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
              {available
                ? <CheckCircle size={13} color="#34C759" strokeWidth={2} />
                : <AlertCircle size={13} color="#FF9500" strokeWidth={2} />}
              <Text style={{ fontSize: 12, color: available ? "#34C759" : "#FF9500", fontWeight: "500" }}>
                {available ? "App installed — deep links available" : "App not installed on this device"}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            {app.deepLinks.map((link) => (
              <Pressable
                key={link.url}
                onPress={() => void openDeepLink(link.url)}
                style={({ pressed }) => [
                  styles.deepLinkBtn,
                  {
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    borderColor: palette.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink, flex: 1 }}>{link.label}</Text>
                <ExternalLink size={13} color={palette.muted} strokeWidth={2} />
              </Pressable>
            ))}
          </View>

          <View style={[styles.schemeRow, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", borderColor: palette.border }]}>
            <Text style={{ fontSize: 11, color: palette.muted, fontFamily: "monospace" }}>{app.urlScheme}</Text>
            <Text style={{ fontSize: 10, color: palette.muted }}>URL scheme</Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export default function ConnectorsSettingsScreen() {
  const { client } = useServer()
  const { palette, isDark } = useAppTheme()
  const { bottom } = useSafeAreaInsets()
  const [statuses, setStatuses] = useState<Record<string, ConnectorStatus>>({})
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [notAvailable, setNotAvailable] = useState(false)

  const connectedCount = Object.values(statuses).filter((s) => s.status === "connected").length

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setNotAvailable(false)
      const data = await client.listConnectors()
      setStatuses(data)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/Request failed with 404/.test(msg) || msg.toLowerCase().includes("not found")) {
        setNotAvailable(true)
      } else {
        setMessage(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function saveCredential(connector: ConnectorDef) {
    if (!client) return
    const value = (credentials[connector.name] ?? "").trim()
    if (!value) return setMessage(`${connector.credentialLabel} is required for ${connector.label}`)
    try {
      setSaving(true)
      setMessage(null)
      await client.setConnectorAuth(connector.name, { [connector.credentialType]: value })
      setCredentials((prev) => ({ ...prev, [connector.name]: "" }))
      void triggerHaptic("success")
      await load()
      setMessage(`${connector.label} credentials saved`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      void triggerHaptic("error")
    } finally {
      setSaving(false)
    }
  }

  async function removeCredential(name: string) {
    if (!client) return
    try {
      setSaving(true)
      setMessage(null)
      await client.removeConnectorAuth(name)
      void triggerHaptic("success")
      await load()
      setMessage("Credentials removed")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      void triggerHaptic("error")
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
      <Stack.Screen options={{ title: "Connectors" }} />

      {/* Header card */}
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow, flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }]}>
        <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(14,165,233,0.08)" }]}>
          <Plug size={20} color={palette.accentLight} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: palette.ink, letterSpacing: -0.2 }}>External Connectors</Text>
          <Text style={{ fontSize: 12, lineHeight: 17, color: palette.muted, marginTop: 2 }}>
            Credentials stored securely on the server and used by AI agents.
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
        <View style={[styles.statPill, { backgroundColor: isDark ? "rgba(52,199,89,0.10)" : "rgba(52,199,89,0.09)", borderColor: "rgba(52,199,89,0.22)" }]}>
          <CheckCircle size={13} color="#34C759" strokeWidth={2} />
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#34C759" }}>{connectedCount} connected</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: palette.border }]}>
          <Link2 size={13} color={palette.muted} strokeWidth={2} />
          <Text style={{ fontSize: 12, fontWeight: "600", color: palette.muted }}>{KNOWN_CONNECTORS.length} available</Text>
        </View>
      </View>

      {/* Error */}
      {message ? (
        <View style={[styles.errorRow, { backgroundColor: isDark ? "rgba(255,59,48,0.10)" : "rgba(255,59,48,0.07)", borderColor: "rgba(255,59,48,0.20)" }]}>
          <AlertCircle size={14} color="#FF3B30" strokeWidth={2} />
          <Text style={{ fontSize: 13, color: "#FF3B30", flex: 1, lineHeight: 18 }}>{message}</Text>
        </View>
      ) : null}

      {notAvailable ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow, padding: 20, alignItems: "center", gap: 10 }]}>
          <AlertCircle size={26} color={palette.muted} strokeWidth={1.6} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>Not available</Text>
          <Text style={{ fontSize: 13, color: palette.soft, textAlign: "center", lineHeight: 19 }}>
            This server does not expose a connector API. Update the server to enable connector management.
          </Text>
        </View>
      ) : (
        <>
          {/* Featured connectors */}
          <Text style={[styles.sectionLabel, { color: palette.muted }]}>Featured</Text>
          {KNOWN_CONNECTORS.filter((c) => c.featured).map((connector) => (
            <ConnectorCard
              key={connector.name}
              connector={connector}
              status={statuses[connector.name]}
              credential={credentials[connector.name] ?? ""}
              saving={saving}
              onCredentialChange={(value) => setCredentials((prev) => ({ ...prev, [connector.name]: value }))}
              onSave={() => void saveCredential(connector)}
              onRemove={() => void removeCredential(connector.name)}
              onDocsOpen={() => connector.docsUrl ? void WebBrowser.openBrowserAsync(connector.docsUrl) : undefined}
            />
          ))}

          {/* More connectors */}
          <Text style={[styles.sectionLabel, { color: palette.muted, marginTop: 6 }]}>More connectors</Text>
          {KNOWN_CONNECTORS.filter((c) => !c.featured).map((connector) => (
            <ConnectorCard
              key={connector.name}
              connector={connector}
              status={statuses[connector.name]}
              credential={credentials[connector.name] ?? ""}
              saving={saving}
              onCredentialChange={(value) => setCredentials((prev) => ({ ...prev, [connector.name]: value }))}
              onSave={() => void saveCredential(connector)}
              onRemove={() => void removeCredential(connector.name)}
              onDocsOpen={() => connector.docsUrl ? void WebBrowser.openBrowserAsync(connector.docsUrl) : undefined}
            />
          ))}
        </>
      )}

      {/* Mobile app deep links */}
      <Text style={[styles.sectionLabel, { color: palette.muted, marginTop: 6 }]}>Mobile app links</Text>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow, padding: 14, gap: 4, flexDirection: "row", alignItems: "flex-start" }]}>
        <Smartphone size={15} color={palette.muted} strokeWidth={2} style={{ marginTop: 1 }} />
        <Text style={{ fontSize: 13, lineHeight: 18, color: palette.soft, flex: 1 }}>
          Open other apps installed on this device using URL schemes. AI agents can trigger these links during sessions.
        </Text>
      </View>
      {MOBILE_APP_LINKS.map((app) => (
        <MobileAppCard key={app.id} app={app} />
      ))}
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
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  expandBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "#8E8E93",
  },
  inputWrap: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
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
  deepLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  schemeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
})
