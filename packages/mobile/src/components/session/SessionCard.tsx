import { View, StyleSheet, Pressable, Platform } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { format } from "date-fns"
import { MotiView } from "moti"
import { Clock, MessageSquare, Terminal } from "lucide-react-native"
import { Card } from "../ui/Card"
import { Badge, StatusDot } from "../ui/Badge"

interface SessionCardProps {
  session: {
    id: string
    name: string
    status: "active" | "idle" | "error" | "stopped"
    createdAt: Date
    lastActivity: Date
    messageCount: number
  }
  onPress?: () => void
}

export function SessionCard({ session, onPress }: SessionCardProps) {
  const theme = useTheme()

  const statusVariant = {
    active: "success",
    idle: "default",
    error: "error",
    stopped: "default",
  } as const

  return (
    <MotiView
      from={{ opacity: 0, translateY: 20 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: "spring", damping: 20 }}
    >
      <Pressable onPress={onPress}>
        <Card variant="elevated" padding="md">
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Terminal size={20} color={theme.colors.primary} />
              <Text style={[styles.name, { color: theme.colors.onSurface }]} numberOfLines={1}>
                {session.name}
              </Text>
            </View>
            <StatusDot status={session.status} />
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <MessageSquare size={14} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.statText, { color: theme.colors.onSurfaceVariant }]}>
                {session.messageCount} messages
              </Text>
            </View>
            <View style={styles.stat}>
              <Clock size={14} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.statText, { color: theme.colors.onSurfaceVariant }]}>
                {format(new Date(session.lastActivity), "HH:mm")}
              </Text>
            </View>
          </View>

          <View style={styles.footer}>
            <Badge variant={statusVariant[session.status]} size="sm">
              {session.status}
            </Badge>
            <Text style={[styles.sessionId, { color: theme.colors.onSurfaceVariant }]}>
              {session.id.slice(0, 8)}...
            </Text>
          </View>
        </Card>
      </Pressable>
    </MotiView>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  statsRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 12,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    fontSize: 12,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sessionId: {
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
})
