import { useState, useEffect } from "react"
import { View, StyleSheet, ScrollView, Pressable } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { useRouter } from "expo-router"
import { MotiView } from "moti"
import { Server, Key, History, Trash2, Wifi, Cloud, Smartphone } from "lucide-react-native"
import { Button, Card, Input, EmptyState } from "@/components/ui"
import { useSSE } from "@/hooks/useSSE"
import { useHapticFeedback } from "@/hooks/useHaptics"
import { useCloudStore } from "@/stores"
import {
  normalizeUrl,
  validateUrl,
  getRecentServers,
  setStoredCredentials,
  getStoredCredentials,
  clearStoredCredentials,
  type ConnectionMode,
} from "@/services/crypto"
import type { StoredServer } from "@/services/crypto"

export default function ConnectScreen() {
  const router = useRouter()
  const theme = useTheme()
  const { light } = useHapticFeedback()
  const { connect, status, error, disconnect } = useSSE()

  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState("")
  const [urlError, setUrlError] = useState("")
  const [recentServers, setRecentServers] = useState<StoredServer[]>([])
  const [isConnecting, setIsConnecting] = useState(false)

  useEffect(() => {
    setRecentServers(getRecentServers())

    const { url: savedUrl, secret: savedSecret } = getStoredCredentials()
    if (savedUrl) setUrl(savedUrl)
    if (savedSecret) setSecret(savedSecret)
  }, [])

  const handleConnect = async () => {
    light()

    const normalizedUrl = normalizeUrl(url)

    if (!validateUrl(normalizedUrl)) {
      setUrlError("Please enter a valid URL")
      return
    }

    if (!secret.trim()) {
      setUrlError("Please enter a session secret")
      return
    }

    setUrlError("")
    setIsConnecting(true)

    try {
      await connect({
        url: normalizedUrl,
        secret: secret.trim(),
      })

      setStoredCredentials(normalizedUrl, secret.trim())
      light()

      router.replace("/(tabs)/")
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setIsConnecting(false)
    }
  }

  const handleServerSelect = (server: StoredServer) => {
    setUrl(server.url)
    setSecret(server.secret)
  }

  const handleClearRecent = () => {
    clearStoredCredentials()
    setRecentServers([])
  }

  const handleDisconnect = async () => {
    await disconnect()
    router.replace("/connect")
  }

  const statusMessage =
    {
      idle: "Ready to connect",
      connecting: "Connecting...",
      connected: "Connected!",
      reconnecting: "Reconnecting...",
      error: "Connection failed",
      closed: "Disconnected",
    }[status] || "Unknown"

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <MotiView from={{ opacity: 0, translateY: -20 }} animate={{ opacity: 1, translateY: 0 }} style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>Connect to Nikcli</Text>
        <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Enter your server details to start receiving real-time events
        </Text>
      </MotiView>

      <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 100 }}>
        <Card variant="elevated" padding="lg">
          <Input
            value={url}
            onChangeText={(text: string) => {
              setUrl(text)
              setUrlError("")
            }}
            placeholder="http://192.168.1.x:3000"
            label="Server URL"
            leftIcon={<Server size={20} color={theme.colors.onSurfaceVariant} />}
            error={urlError}
            keyboardType="url"
            autoCapitalize="none"
            onSubmitEditing={() => secret && handleConnect()}
            returnKeyType="next"
          />

          <Input
            value={secret}
            onChangeText={(text: string) => {
              setSecret(text)
              setUrlError("")
            }}
            placeholder="Enter session secret"
            label="Session Secret"
            leftIcon={<Key size={20} color={theme.colors.onSurfaceVariant} />}
            secureTextEntry
            onSubmitEditing={handleConnect}
            returnKeyType="done"
          />

          {error && (
            <View style={[styles.errorContainer, { backgroundColor: theme.colors.errorContainer }]}>
              <Text style={[styles.errorText, { color: theme.colors.onErrorContainer }]}>{error}</Text>
            </View>
          )}

          <View style={styles.statusRow}>
            <Wifi size={16} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.statusText, { color: theme.colors.onSurfaceVariant }]}>{statusMessage}</Text>
          </View>

          <View style={styles.buttonRow}>
            <Button
              title="Connect"
              onPress={handleConnect}
              loading={isConnecting || status === "connecting"}
              disabled={!url || !secret || status === "connected"}
              fullWidth
            />
            {status === "connected" && (
              <Button title="Disconnect" onPress={handleDisconnect} variant="danger" fullWidth />
            )}
          </View>
        </Card>
      </MotiView>

      {recentServers.length > 0 && (
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 200 }}
          style={styles.recentSection}
        >
          <View style={styles.recentHeader}>
            <View style={styles.recentTitleRow}>
              <History size={18} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Recent Servers</Text>
            </View>
            <Pressable onPress={handleClearRecent}>
              <Trash2 size={16} color={theme.colors.error} />
            </Pressable>
          </View>

          {recentServers.map((server, index) => (
            <MotiView
              key={server.url}
              from={{ opacity: 0, translateX: -20 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ delay: 250 + index * 50 }}
            >
              <Pressable onPress={() => handleServerSelect(server)}>
                <Card variant="outlined">
                  <View style={styles.recentCardContent}>
                    <Text style={[styles.recentUrl, { color: theme.colors.onSurface }]}>
                      {server.url.replace(/^https?:\/\//, "")}
                    </Text>
                    <Text style={[styles.recentDate, { color: theme.colors.onSurfaceVariant }]}>
                      {new Date(server.lastConnected).toLocaleDateString()}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            </MotiView>
          ))}
        </MotiView>
      )}

      {recentServers.length === 0 && status === "idle" && (
        <EmptyState
          icon={<Server size={48} color={theme.colors.onSurfaceVariant} />}
          title="No recent servers"
          description="Enter your server URL and secret to connect"
        />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingTop: 60,
    gap: 24,
  },
  header: {
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  errorContainer: {
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  statusText: {
    fontSize: 13,
  },
  buttonRow: {
    gap: 12,
    marginTop: 16,
  },
  recentSection: {
    gap: 12,
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  recentCard: {
    marginBottom: 8,
  },
  recentCardContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recentUrl: {
    fontSize: 14,
    fontWeight: "500",
  },
  recentDate: {
    fontSize: 12,
  },
})
