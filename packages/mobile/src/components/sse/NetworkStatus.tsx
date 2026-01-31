import { View, StyleSheet } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { MotiView } from "moti"
import { Wifi, WifiOff, Globe } from "lucide-react-native"
import { useNetInfo } from "../../hooks/useOffline"

export function NetworkStatusIndicator() {
  const netInfo = useNetInfo()
  const theme = useTheme()

  const config = netInfo.isConnected
    ? {
        color: theme.colors.primary,
        label: "Online",
        icon: Wifi,
      }
    : {
        color: theme.colors.error,
        label: "Offline",
        icon: WifiOff,
      }

  const Icon = config.icon

  return (
    <MotiView
      from={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      style={[styles.container, { backgroundColor: theme.colors.surfaceVariant }]}
    >
      <Icon size={16} color={config.color} />
      <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>{config.label}</Text>
      {netInfo.type !== "unknown" && (
        <Text style={[styles.type, { color: theme.colors.onSurfaceVariant }]}>
          {netInfo.type === "wifi" ? "WiFi" : netInfo.type === "cellular" ? "Cellular" : ""}
        </Text>
      )}
    </MotiView>
  )
}

export function FullScreenOffline() {
  const theme = useTheme()

  return (
    <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.fullscreen}>
      <MotiView
        from={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", damping: 15 }}
        style={styles.content}
      >
        <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
          <WifiOff size={48} color={theme.colors.onSurfaceVariant} />
        </View>

        <Text style={[styles.title, { color: theme.colors.onSurface }]}>You're Offline</Text>

        <Text style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
          Check your internet connection and try again.
        </Text>
      </MotiView>
    </MotiView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: "500",
  },
  type: {
    fontSize: 10,
    textTransform: "capitalize",
  },
  fullscreen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#1a1a2e",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    gap: 16,
    padding: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  description: {
    fontSize: 16,
    textAlign: "center",
  },
})
