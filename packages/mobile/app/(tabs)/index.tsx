import { View, StyleSheet, FlatList } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { MotiView } from "moti"
import { RefreshCw, Activity, Calendar, Clock } from "lucide-react-native"
import { useEffect } from "react"
import { useRouter } from "expo-router"
import { Card, Button, Badge, Loading } from "../../components/ui"
import { ConnectionStatusIndicator, NetworkStatusIndicator } from "../../components/sse"
import { SessionCard } from "../../components/session"
import { useSSE } from "../../hooks/useSSE"
import { useSessionsStore, useEventsStore, useConnectionStore } from "../../stores"

export default function DashboardScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { status, serverUrl, lastEventAt, reconnect, isActive } = useSSE()
  const sessionsStore = useSessionsStore()
  const eventsStore = useEventsStore()
  const connectionStore = useConnectionStore()

  const sessions = Object.values(sessionsStore.sessions)
  const recentEvents = eventsStore.getFilteredEvents().slice(0, 5)

  const stats = {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s: any) => s.status === "active").length,
    totalEvents: eventsStore.eventIds.length,
    unreadEvents: eventsStore.unreadCount,
  }

  const StatCard = ({
    title,
    value,
    icon,
    color,
  }: {
    title: string
    value: string | number
    icon: any
    color: string
  }) => (
    <MotiView
      from={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 100 }}
      style={[styles.statCard, { backgroundColor: theme.colors.surfaceVariant }]}
    >
      <View style={[styles.statIcon, { backgroundColor: color + "20" }]}>{icon}</View>
      <Text style={[styles.statValue, { color: theme.colors.onSurface }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}>{title}</Text>
    </MotiView>
  )

  const renderSession = ({ item }: { item: any }) => (
    <SessionCard session={item} onPress={() => router.push(`/session/${item.id}`)} />
  )

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={[styles.greeting, { color: theme.colors.onBackground }]}>Dashboard</Text>
          <NetworkStatusIndicator />
        </View>

        <ConnectionStatusIndicator status={status} lastEventAt={lastEventAt} serverUrl={serverUrl} />

        {status === "error" && (
          <Button
            title="Retry Connection"
            onPress={reconnect}
            variant="outline"
            size="sm"
            icon={<RefreshCw size={16} />}
          />
        )}
      </View>

      <FlatList
        data={sessions}
        renderItem={({ item }: { item: any }) => (
          <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }}>
            <SessionCard session={item} onPress={() => router.push(`/session/${item.id}`)} />
          </MotiView>
        )}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.statsGrid}>
              <StatCard
                title="Total Sessions"
                value={stats.totalSessions}
                icon={<Activity size={24} color={theme.colors.primary} />}
                color={theme.colors.primary}
              />
              <StatCard
                title="Active"
                value={stats.activeSessions}
                icon={<Clock size={24} color={theme.colors.tertiary} />}
                color={theme.colors.tertiary}
              />
              <StatCard
                title="Total Events"
                value={stats.totalEvents}
                icon={<Calendar size={24} color={theme.colors.secondary} />}
                color={theme.colors.secondary}
              />
              <StatCard
                title="Unread"
                value={stats.unreadEvents}
                icon={<Activity size={24} color={theme.colors.error} />}
                color={theme.colors.error}
              />
            </View>

            <Text style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Active Sessions</Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Activity size={48} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No active sessions</Text>
            <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
              Connect to a server to see sessions
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    gap: 16,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greeting: {
    fontSize: 28,
    fontWeight: "700",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    width: "48%",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    gap: 8,
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  statValue: {
    fontSize: 28,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyContainer: {
    alignItems: "center",
    padding: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
})
