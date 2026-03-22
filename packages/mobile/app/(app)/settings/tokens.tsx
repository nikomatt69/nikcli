import { useCallback, useEffect, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import { relativeTime, type MobileAuthToken } from "@/lib/types"

export default function TokensSettingsScreen() {
  const { client } = useServer()
  const [tokens, setTokens] = useState<MobileAuthToken[]>([])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenName, setTokenName] = useState("")
  const [expiresInDays, setExpiresInDays] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setTokens(await client.listAuthTokens())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
      // Clear any visible token when leaving the screen
      return () => setNewToken(null)
    }, [load]),
  )

  async function createToken() {
    if (!client) return
    try {
      setSaving(true)
      setMessage(null)
      const daysRaw = expiresInDays.trim()
      const days = daysRaw ? Number(daysRaw) : undefined
      if (days !== undefined && (!Number.isInteger(days) || days <= 0)) {
        setMessage("Expiry must be a positive whole number of days")
        return
      }
      const result = await client.createAuthToken(tokenName.trim() || undefined, days)
      setNewToken(result.token)
      setTokenName("")
      setExpiresInDays("")
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function revokeToken(id: string) {
    if (!client) return
    try {
      setSaving(true)
      setMessage(null)
      await client.revokeAuthToken(id)
      await load()
      setMessage("Token revoked")
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
      <Stack.Screen options={{ title: "Access Tokens" }} />

      <SurfaceCard
        eyebrow="Security"
        title="Long-lived bearer tokens"
        description="Create scoped mobile bearer tokens for this server connection. Tokens never expire unless you set a duration or revoke them manually."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${tokens.length} active tokens`} tone={tokens.length ? "accent" : "neutral"} />
          <InfoChip label="Bearer auth" tone="good" />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      <SurfaceCard
        eyebrow="Create token"
        title="Issue a new bearer token"
        description="Give it a name and optional expiry. Copy and store the token immediately — it will not be shown again."
      >
        <View className="gap-3">
          <TextField
            label="Token name (optional)"
            value={tokenName}
            onChangeText={setTokenName}
            autoCapitalize="none"
            placeholder="e.g. iPhone personal"
          />
          <TextField
            label="Expires in days (optional)"
            value={expiresInDays}
            onChangeText={setExpiresInDays}
            keyboardType="numeric"
            placeholder="e.g. 90 — leave blank for no expiry"
          />
          <ActionButton label="Create Token" loading={saving} onPress={() => void createToken()} />
        </View>
      </SurfaceCard>

      {newToken ? (
        <SurfaceCard
          eyebrow="New token"
          title="Copy now — not shown again"
          description="Store this token securely. Once you navigate away you cannot retrieve this value again."
        >
          <Text selectable className="mt-2 rounded-[14px] border border-border bg-background/80 px-4 py-3 font-mono text-sm text-ink">
            {newToken}
          </Text>
          <View className="mt-3">
            <ActionButton
              label="Dismiss"
              variant="secondary"
              onPress={() => setNewToken(null)}
            />
          </View>
        </SurfaceCard>
      ) : null}

      <SurfaceCard
        eyebrow="Active tokens"
        title="Issued bearer tokens"
        description="Revoke any token to immediately invalidate it on the server."
      >
        {loading ? (
          <View className="items-center rounded-[22px] border border-border bg-background/60 px-4 py-5">
            <Text className="text-sm text-soft">Loading tokens…</Text>
          </View>
        ) : (
          <View className="gap-3">
            {tokens.length ? (
              tokens.map((token) => (
                <View key={token.id} className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
                  <View className="flex-row flex-wrap gap-2">
                    {token.name ? <InfoChip label={token.name} tone="accent" /> : null}
                    <InfoChip label={`Created ${relativeTime(token.createdAt)}`} />
                    {token.lastUsedAt ? <InfoChip label={`Used ${relativeTime(token.lastUsedAt)}`} /> : null}
                    {token.expiresAt ? (
                      <InfoChip
                        label={token.expiresAt > Date.now() ? `Expires ${relativeTime(token.expiresAt)}` : "Expired"}
                        tone={token.expiresAt > Date.now() ? "neutral" : "warn"}
                      />
                    ) : (
                      <InfoChip label="No expiry" tone="neutral" />
                    )}
                  </View>
                  <Text selectable className="mt-2 text-xs text-soft font-mono">
                    {token.id}
                  </Text>
                  <View className="mt-3">
                    <ActionButton
                      label="Revoke"
                      variant="secondary"
                      disabled={saving}
                      onPress={() => void revokeToken(token.id)}
                    />
                  </View>
                </View>
              ))
            ) : (
              <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
                <Text className="text-sm leading-6 text-soft">No active tokens. Create one above.</Text>
              </View>
            )}
          </View>
        )}
      </SurfaceCard>
    </ScrollView>
  )
}
