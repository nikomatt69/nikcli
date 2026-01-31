import { View, StyleSheet } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { MotiView } from "moti"
import type { ConnectionStatus } from "../../types"

interface ConnectionStatusProps {
  status: ConnectionStatus
  lastEventAt: number | null
  serverUrl: string | null
}

export function ConnectionStatusIndicator({ status, lastEventAt, serverUrl }: ConnectionStatusProps) {
  const theme = useTheme()

  const statusConfig = {
    idle: {
      color: theme.colors.outline,
      label: "Disconnected",
      icon: "circle",
    },
    connecting: {
      color: theme.colors.tertiary,
      label: "Connecting...",
      icon: "loader",
    },
    connected: {
      color: theme.colors.primary,
      label: "Connected",
      icon: "check-circle",
    },
    reconnecting: {
      color: theme.colors.secondary,
      label: "Reconnecting...",
      icon: "refresh-cw",
    },
    error: {
      color: theme.colors.error,
      label: "Error",
      icon: "alert-circle",
    },
    closed: {
      color: theme.colors.outline,
      label: "Closed",
      icon: "circle",
    },
  }

  const config = statusConfig[status]
  const formattedUrl = serverUrl ? serverUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : null

  return (
    <View style={styles.container}>
      <MotiView
        from={{ scale: 0.8, opacity: 0.5 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "timing",
          duration: 300,
        }}
        style={[styles.statusDot, { backgroundColor: config.color }]}
      />
      <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>{config.label}</Text>
      {status === "connected" && lastEventAt && (
        <Text style={[styles.timestamp, { color: theme.colors.onSurfaceVariant }]}>
          Last event: {formatRelativeTime(lastEventAt)}
        </Text>
      )}
      {formattedUrl && <Text style={[styles.url, { color: theme.colors.onSurfaceVariant }]}>{formattedUrl}</Text>}
    </View>
  )
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 60000) {
    return "just now"
  } else if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000)
    return `${minutes}m ago`
  } else if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000)
    return `${hours}h ago`
  } else {
    const days = Math.floor(diff / 86400000)
    return `${days}d ago`
  }
}

interface PulseIndicatorProps {
  active: boolean
  color?: string
}

export function PulseIndicator({ active, color }: PulseIndicatorProps) {
  const theme = useTheme()

  return (
    <MotiView
      from={{ scale: 1, opacity: 1 }}
      animate={{ scale: active ? 1.5 : 1, opacity: active ? 0 : 1 }}
      transition={{
        duration: 1500,
        repeat: active ? Infinity : 0,
        type: "timing",
      }}
      style={[styles.pulseDot, { backgroundColor: color || theme.colors.primary }]}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
  timestamp: {
    fontSize: 12,
    marginLeft: "auto",
  },
  url: {
    fontSize: 12,
    marginLeft: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
