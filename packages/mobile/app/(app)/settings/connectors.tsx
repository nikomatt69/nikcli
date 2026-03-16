import { useCallback, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import { type ConnectorStatus } from "@/lib/types"

type ConnectorDef = {
  name: string
  label: string
  credentialType: "token" | "botToken" | "apiKey"
  credentialLabel: string
  placeholder: string
}

const KNOWN_CONNECTORS: ConnectorDef[] = [
  { name: "figma", label: "Figma", credentialType: "apiKey", credentialLabel: "API Key", placeholder: "figd_..." },
  { name: "slack", label: "Slack", credentialType: "botToken", credentialLabel: "Bot Token", placeholder: "xoxb-..." },
  { name: "discord", label: "Discord", credentialType: "botToken", credentialLabel: "Bot Token", placeholder: "Bot token" },
  { name: "teams", label: "Microsoft Teams", credentialType: "token", credentialLabel: "Token", placeholder: "Bearer token" },
  { name: "linear", label: "Linear", credentialType: "apiKey", credentialLabel: "API Key", placeholder: "lin_api_..." },
  { name: "lovable", label: "Lovable", credentialType: "apiKey", credentialLabel: "API Key", placeholder: "API key" },
  { name: "gchat", label: "Google Chat", credentialType: "token", credentialLabel: "Token", placeholder: "OAuth token" },
]

function connectorTone(status?: ConnectorStatus): "good" | "warn" | "neutral" {
  if (!status) return "neutral"
  if (status.status === "connected") return "good"
  if (status.status === "needs_auth" || status.status === "failed") return "warn"
  return "neutral"
}

function connectorLabel(status?: ConnectorStatus) {
  if (!status) return "Unknown"
  switch (status.status) {
    case "connected": return "Connected"
    case "disabled": return "Disabled"
    case "needs_auth": return "Needs auth"
    case "failed": return "Failed"
  }
}

export default function ConnectorsSettingsScreen() {
  const { client } = useServer()
  const [statuses, setStatuses] = useState<Record<string, ConnectorStatus>>({})
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [notAvailable, setNotAvailable] = useState(false)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setNotAvailable(false)
      const data = await client.listConnectors()
      setStatuses(data)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes("404") || msg.includes("not found")) {
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
      await load()
      setMessage(`${connector.label} credentials saved`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
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
      await load()
      setMessage(`Credentials removed`)
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
      <Stack.Screen options={{ title: "Connectors" }} />

      <SurfaceCard
        eyebrow="Integrations"
        title="External service connectors"
        description="Connect external services to the AI host. Credentials are stored securely on the server and used by AI agents during sessions."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${KNOWN_CONNECTORS.length} connectors`} tone="accent" />
          <InfoChip label={`${Object.values(statuses).filter((s) => s.status === "connected").length} connected`} tone="good" />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      {notAvailable ? (
        <SurfaceCard
          eyebrow="Unavailable"
          title="Connectors not available"
          description="This server does not expose a connector API. Update the server to enable connector management."
        >
          <InfoChip label="Not available on this server" tone="warn" />
        </SurfaceCard>
      ) : (
        <View className="gap-4">
          {KNOWN_CONNECTORS.map((connector) => {
            const status = statuses[connector.name]
            const canRemove = status?.status !== "disabled"
            return (
              <SurfaceCard
                key={connector.name}
                eyebrow={connector.label}
                title={connector.label}
                description={`${connector.credentialType === "botToken" ? "Bot token" : connector.credentialType === "apiKey" ? "API key" : "Token"} required`}
              >
                {loading ? (
                  <View className="flex-row flex-wrap gap-2">
                    <InfoChip label="Loading…" tone="neutral" />
                  </View>
                ) : (
                  <View className="gap-3">
                    <View className="flex-row flex-wrap gap-2">
                      <InfoChip label={connector.name} tone="accent" />
                      <InfoChip label={connectorLabel(status)} tone={connectorTone(status)} />
                      {status?.status === "failed" ? (
                        <InfoChip label={status.error} tone="warn" />
                      ) : null}
                    </View>
                    <TextField
                      label={connector.credentialLabel}
                      value={credentials[connector.name] ?? ""}
                      onChangeText={(value) => setCredentials((prev) => ({ ...prev, [connector.name]: value }))}
                      autoCapitalize="none"
                      secureTextEntry
                      placeholder={connector.placeholder}
                    />
                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <ActionButton
                          label="Save credentials"
                          loading={saving}
                          onPress={() => void saveCredential(connector)}
                        />
                      </View>
                      {canRemove ? (
                        <View className="flex-1">
                          <ActionButton
                            label="Remove"
                            variant="secondary"
                            disabled={saving}
                            onPress={() => void removeCredential(connector.name)}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                )}
              </SurfaceCard>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}
