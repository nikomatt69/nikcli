import { useEffect, useRef } from "react"
import { View, StyleSheet, FlatList, Pressable, Platform } from "react-native"
import { Text, useTheme, TouchableRipple } from "react-native-paper"
import { format } from "date-fns"
import type { SSEEvent } from "../../types"

interface EventStreamProps {
  events: SSEEvent[]
  onEventPress?: (event: SSEEvent) => void
  onClear?: () => void
  showFilters?: boolean
}

export function EventStream({ events, onEventPress, onClear, showFilters = false }: EventStreamProps) {
  const theme = useTheme()
  const flatListRef = useRef<FlatList>(null)

  useEffect(() => {
    if (events.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true })
    }
  }, [events.length])

  const renderItem = ({ item }: { item: SSEEvent }) => {
    const data = item.data as Record<string, unknown> | undefined
    const eventType = data?.type as string | undefined
    const properties = data?.properties as Record<string, unknown> | undefined

    return (
      <TouchableRipple
        onPress={() => onEventPress?.(item)}
        style={[styles.eventItem, { backgroundColor: theme.colors.surfaceVariant }]}
      >
        <View style={styles.eventContent}>
          <View style={styles.eventHeader}>
            <View style={styles.eventTypeContainer}>
              <Text style={[styles.eventType, { color: theme.colors.primary }]} numberOfLines={1}>
                {eventType || "unknown"}
              </Text>
            </View>
            <Text style={[styles.eventTime, { color: theme.colors.onSurfaceVariant }]}>
              {format(new Date(item.timestamp), "HH:mm:ss")}
            </Text>
          </View>

          {properties && (
            <Text style={[styles.eventData, { color: theme.colors.onSurface }]} numberOfLines={3}>
              {JSON.stringify(properties, null, 2)}
            </Text>
          )}

          <View style={styles.eventFooter}>
            <Text style={[styles.eventId, { color: theme.colors.onSurfaceVariant }]}>ID: {item.id || "N/A"}</Text>
          </View>
        </View>
      </TouchableRipple>
    )
  }

  const keyExtractor = (item: SSEEvent) => item.id || `evt_${item.timestamp}_${Math.random().toString(36).slice(2, 9)}`

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>Events ({events.length})</Text>
        {onClear && events.length > 0 && (
          <Pressable onPress={onClear}>
            <Text style={[styles.clearText, { color: theme.colors.error }]}>Clear</Text>
          </Pressable>
        )}
      </View>

      {events.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
            No events yet. Waiting for server...
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={events}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          inverted={false}
          showsVerticalScrollIndicator={true}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  clearText: {
    fontSize: 14,
    fontWeight: "500",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  listContent: {
    padding: 12,
    gap: 8,
  },
  eventItem: {
    borderRadius: 8,
    overflow: "hidden",
  },
  eventContent: {
    padding: 12,
    gap: 8,
  },
  eventHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eventTypeContainer: {
    flex: 1,
    marginRight: 8,
  },
  eventType: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  eventTime: {
    fontSize: 12,
  },
  eventData: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  eventFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  eventId: {
    fontSize: 10,
  },
})
