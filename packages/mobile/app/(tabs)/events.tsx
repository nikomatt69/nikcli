import { useState } from "react"
import { View, StyleSheet, FlatList, TextInput, Pressable } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { Search, X } from "lucide-react-native"
import { EmptyState } from "../../components/ui"
import { EventStream } from "../../components/sse"
import { useEventsStore } from "../../stores"
import { useHapticFeedback } from "../../hooks/useHaptics"

const EVENT_TYPES = [
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "message.updated",
  "permission.asked",
  "tui.toast.show",
  "command.executed",
  "file.edited",
  "lsp.client.diagnostics",
]

export default function EventsScreen() {
  const theme = useTheme()
  const { light } = useHapticFeedback()
  const eventsStore = useEventsStore()

  const [search, setSearch] = useState("")
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  const toggleType = (type: string) => {
    light()
    if (selectedTypes.includes(type)) {
      setSelectedTypes(selectedTypes.filter((t) => t !== type))
    } else {
      setSelectedTypes([...selectedTypes, type])
    }
  }

  const handleClear = () => {
    eventsStore.clearEvents()
    light()
  }

  const events = eventsStore.getFilteredEvents()

  const filteredEvents =
    selectedTypes.length > 0
      ? events.filter((event: any) => {
          const type = event.data?.type as string | undefined
          return type && selectedTypes.includes(type)
        })
      : events

  const FilterChip = ({ type }: { type: string }) => (
    <Pressable
      onPress={() => toggleType(type)}
      style={[
        styles.filterChip,
        {
          backgroundColor: selectedTypes.includes(type) ? theme.colors.primary : theme.colors.surfaceVariant,
        },
      ]}
    >
      <Text
        style={[
          styles.filterText,
          {
            color: selectedTypes.includes(type) ? theme.colors.onPrimary : theme.colors.onSurfaceVariant,
          },
        ]}
      >
        {type}
      </Text>
    </Pressable>
  )

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.colors.onBackground }]}>Events</Text>
          {events.length > 0 && (
            <Pressable onPress={handleClear} style={styles.clearButton}>
              <Text style={[styles.clearText, { color: theme.colors.error }]}>Clear</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.searchContainer}>
          <Search size={20} color={theme.colors.onSurfaceVariant} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.onSurface }]}
            placeholder="Search events..."
            placeholderTextColor={theme.colors.onSurfaceVariant}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <X size={20} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          )}
        </View>

        <Text style={[styles.filterLabel, { color: theme.colors.onSurfaceVariant }]}>Filter by type:</Text>

        <FlatList
          data={EVENT_TYPES}
          renderItem={({ item }) => <FilterChip type={item} />}
          keyExtractor={(item) => item}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
        />
      </View>

      <View style={styles.eventsContainer}>
        <EventStream
          events={filteredEvents}
          onEventPress={(_event: any) => {
            console.log("Event pressed:", _event)
          }}
          onClear={handleClear}
          showFilters={false}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  clearButton: {
    padding: 8,
  },
  clearText: {
    fontSize: 14,
    fontWeight: "500",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e4e1ec",
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  filterLabel: {
    fontSize: 13,
    marginTop: 8,
  },
  filterList: {
    gap: 8,
    paddingVertical: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterText: {
    fontSize: 12,
    fontWeight: "500",
  },
  eventsContainer: {
    flex: 1,
  },
})
