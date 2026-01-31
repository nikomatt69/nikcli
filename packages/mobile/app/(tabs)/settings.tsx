import { View, StyleSheet, Pressable, ScrollView } from "react-native"
import { Text, useTheme, Switch, Divider } from "react-native-paper"
import { MotiView } from "moti"
import { Moon, Sun, Smartphone, Bell, Volume2, Zap, Wifi, LogOut } from "lucide-react-native"
import { Card, Button } from "../../components/ui"
import { useSettingsStore } from "../../stores"
import { useHapticFeedback } from "../../hooks/useHaptics"
import { useSSE } from "../../hooks/useSSE"
import { clearStoredCredentials } from "../../services/crypto"
import { router } from "expo-router"

export default function SettingsScreen() {
  const theme = useTheme()
  const { light, heavy } = useHapticFeedback()
  const { status, disconnect } = useSSE()
  const settingsStore = useSettingsStore()

  const handleThemeChange = (themeValue: "light" | "dark" | "system") => {
    settingsStore.setTheme(themeValue)
    light()
  }

  const handleDisconnect = async () => {
    await disconnect()
    clearStoredCredentials()
    router.replace("/connect")
  }

  const SettingRow = ({
    title,
    description,
    icon,
    children,
    onPress,
  }: {
    title: string
    description?: string
    icon: any
    children?: React.ReactNode
    onPress?: () => void
  }) => (
    <Pressable onPress={onPress} style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <View style={[styles.settingIcon, { backgroundColor: theme.colors.surfaceVariant }]}>
          <icon size={20} color={theme.colors.primary} />
        </View>
        <View style={styles.settingText}>
          <Text style={[styles.settingTitle, { color: theme.colors.onSurface }]}>{title}</Text>
          {description && (
            <Text style={[styles.settingDescription, { color: theme.colors.onSurfaceVariant }]}>{description}</Text>
          )}
        </View>
      </View>
      {children}
    </Pressable>
  )

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
    >
      <MotiView from={{ opacity: 0, translateY: -20 }} animate={{ opacity: 1, translateY: 0 }}>
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>Settings</Text>
      </MotiView>

      <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 100 }}>
        <Card variant="elevated" padding="none">
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Appearance</Text>

          <View style={styles.themeSelector}>
            {(["light", "dark", "system"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => handleThemeChange(t)}
                style={[
                  styles.themeOption,
                  {
                    backgroundColor: settingsStore.theme === t ? theme.colors.primary : theme.colors.surfaceVariant,
                  },
                ]}
              >
                {t === "light" && (
                  <Sun
                    size={20}
                    color={settingsStore.theme === t ? theme.colors.onPrimary : theme.colors.onSurfaceVariant}
                  />
                )}
                {t === "dark" && (
                  <Moon
                    size={20}
                    color={settingsStore.theme === t ? theme.colors.onPrimary : theme.colors.onSurfaceVariant}
                  />
                )}
                {t === "system" && (
                  <Smartphone
                    size={20}
                    color={settingsStore.theme === t ? theme.colors.onPrimary : theme.colors.onSurfaceVariant}
                  />
                )}
                <Text
                  style={[
                    styles.themeText,
                    {
                      color: settingsStore.theme === t ? theme.colors.onPrimary : theme.colors.onSurface,
                    },
                  ]}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      </MotiView>

      <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 200 }}>
        <Card variant="elevated" padding="none" style={styles.card}>
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Notifications</Text>

          <SettingRow title="Push Notifications" description="Receive notifications for events" icon={Bell}>
            <Switch
              value={settingsStore.notifications}
              onValueChange={() => {
                settingsStore.toggleNotifications()
                light()
              }}
            />
          </SettingRow>

          <Divider style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

          <SettingRow title="Sound" description="Play sound on notifications" icon={Volume2}>
            <Switch
              value={settingsStore.sound}
              onValueChange={() => {
                settingsStore.toggleSound()
                light()
              }}
            />
          </SettingRow>

          <Divider style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

          <SettingRow title="Haptic Feedback" description="Vibrate on interactions" icon={Zap}>
            <Switch
              value={settingsStore.haptic}
              onValueChange={() => {
                settingsStore.toggleHaptic()
                heavy()
              }}
            />
          </SettingRow>
        </Card>
      </MotiView>

      <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 300 }}>
        <Card variant="elevated" padding="none" style={styles.card}>
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Connection</Text>

          <SettingRow title="Auto Connect" description="Connect to last server on launch" icon={Wifi}>
            <Switch
              value={settingsStore.autoConnect}
              onValueChange={() => {
                settingsStore.setAutoConnect(!settingsStore.autoConnect)
                light()
              }}
            />
          </SettingRow>

          <Divider style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

          <SettingRow title="Heartbeat Interval" description={`${settingsStore.heartbeatInterval / 1000}s`} icon={Zap}>
            <Text style={[styles.value, { color: theme.colors.onSurfaceVariant }]}>
              {settingsStore.heartbeatInterval / 1000}s
            </Text>
          </SettingRow>
        </Card>
      </MotiView>

      <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 400 }}>
        <Button title="Disconnect" variant="danger" onPress={handleDisconnect} fullWidth icon={<LogOut size={20} />} />
      </MotiView>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  card: {
    gap: 0,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    padding: 16,
    paddingBottom: 8,
  },
  themeSelector: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
  },
  themeOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    gap: 6,
  },
  themeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  settingDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  value: {
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginLeft: 68,
  },
})
