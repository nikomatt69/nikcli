import { useCallback, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import type { ProviderCatalog } from "@/lib/types"

const CODEX_PROVIDER_ID = "openai"
const CURSOR_PROVIDER_ID = "cursor"
const COPILOT_PROVIDER_ID = "github-copilot"

function PluginSection({
  providerID,
  name,
  description,
  placeholder,
  connected,
  onSave,
  onRemove,
  saving,
  removing,
  note,
}: {
  providerID: string
  name: string
  description: string
  placeholder: string
  connected: boolean
  onSave: (providerID: string, key: string) => Promise<void>
  onRemove: (providerID: string) => Promise<void>
  saving: boolean
  removing: boolean
  note?: string
}) {
  const [apiKey, setApiKey] = useState("")

  return (
    <SurfaceCard
      eyebrow={name}
      title={connected ? `${name} connected` : `${name} not connected`}
      description={description}
    >
      <View className="gap-3">
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={connected ? "Connected" : "Not connected"} tone={connected ? "good" : "warn"} />
        </View>

        {note ? (
          <View className="rounded-[8px] border border-border bg-background/60 px-4 py-3">
            <Text className="text-[12px] leading-5 text-soft">{note}</Text>
          </View>
        ) : null}

        <TextField
          label="API key"
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          placeholder={placeholder}
          secureTextEntry
        />

        <View className="flex-row gap-2">
          <View className="flex-1">
            <ActionButton
              label="Save API key"
              loading={saving}
              disabled={!apiKey.trim()}
              onPress={async () => {
                await onSave(providerID, apiKey.trim())
                setApiKey("")
              }}
            />
          </View>
          {connected ? (
            <View className="flex-1">
              <ActionButton
                label="Remove auth"
                variant="secondary"
                loading={removing}
                onPress={() => onRemove(providerID)}
              />
            </View>
          ) : null}
        </View>
      </View>
    </SurfaceCard>
  )
}

export default function PluginsSettingsScreen() {
  const { client } = useServer()
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      const next = await client.listProviders()
      setCatalog(next)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const connected = new Set(catalog?.connected ?? [])

  async function saveKey(providerID: string, key: string) {
    if (!client) return
    try {
      setSaving(providerID)
      setMessage(null)
      await client.setProviderApiKey(providerID, key)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(null)
    }
  }

  async function removeAuth(providerID: string) {
    if (!client) return
    try {
      setRemoving(providerID)
      setMessage(null)
      await client.removeProviderAuth(providerID)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "Plugins" }} />

      <SurfaceCard
        eyebrow="AI plugin auth"
        title="Third-party model providers"
        description="Connect Codex, Cursor, and GitHub Copilot with API keys. Full OAuth flows for Cursor and Codex require the desktop app; Copilot API keys work directly from the host."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip
            label={connected.has(CODEX_PROVIDER_ID) ? "Codex ready" : "Codex offline"}
            tone={connected.has(CODEX_PROVIDER_ID) ? "good" : "neutral"}
          />
          <InfoChip
            label={connected.has(CURSOR_PROVIDER_ID) ? "Cursor ready" : "Cursor offline"}
            tone={connected.has(CURSOR_PROVIDER_ID) ? "good" : "neutral"}
          />
          <InfoChip
            label={connected.has(COPILOT_PROVIDER_ID) ? "Copilot ready" : "Copilot offline"}
            tone={connected.has(COPILOT_PROVIDER_ID) ? "good" : "neutral"}
          />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      <PluginSection
        providerID={CODEX_PROVIDER_ID}
        name="Codex"
        description="OpenAI Codex via ChatGPT Pro or Plus. Enter an API key from platform.openai.com to authenticate on this host."
        placeholder="sk-..."
        connected={connected.has(CODEX_PROVIDER_ID)}
        onSave={saveKey}
        onRemove={removeAuth}
        saving={saving === CODEX_PROVIDER_ID}
        removing={removing === CODEX_PROVIDER_ID}
        note="The browser-based Codex OAuth flow is only available in the desktop app. Use an OpenAI API key here instead."
      />

      <PluginSection
        providerID={CURSOR_PROVIDER_ID}
        name="Cursor"
        description="Cursor AI models accessed through the cursor-agent proxy. Enter an API key to authenticate on this host."
        placeholder="cursor-..."
        connected={connected.has(CURSOR_PROVIDER_ID)}
        onSave={saveKey}
        onRemove={removeAuth}
        saving={saving === CURSOR_PROVIDER_ID}
        removing={removing === CURSOR_PROVIDER_ID}
        note="The Cursor session import and Sign-in flows require the cursor-agent CLI on the desktop. Use an API key here instead."
      />

      <PluginSection
        providerID={COPILOT_PROVIDER_ID}
        name="GitHub Copilot"
        description="GitHub Copilot models via the Copilot API. Enter an API key or OAuth token from your GitHub account to authenticate on this host."
        placeholder="ghu_... or ghp_..."
        connected={connected.has(COPILOT_PROVIDER_ID)}
        onSave={saveKey}
        onRemove={removeAuth}
        saving={saving === COPILOT_PROVIDER_ID}
        removing={removing === COPILOT_PROVIDER_ID}
      />
    </ScrollView>
  )
}
