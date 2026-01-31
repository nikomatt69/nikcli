import { useEffect, useState } from "react"
import { View, StyleSheet, FlatList, TextInput, Pressable } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { MotiView } from "moti"
import { Search, X, Filter } from "lucide-react-native"
import { Card, Button, Badge, EmptyState } from "@/components/ui"
import { SessionCard } from "@/components/session"
import { useSessionsStore } from "@/stores"
import { useSSE } from "@/hooks/useSSE"
import { useHapticFeedback } from "@/hooks/useHaptics"

export default function SessionsScreen() {
  const theme = useTheme()
  const { light } = useHapticFeedback()
  const sessionsStore = useSessionsStore()
  const { status } = useSSE()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "idle" | "error">("all")

  const sessions = Object.values(sessionsStore.sessions)
  const filteredSessions = sessions.filter((session: any) => {
    const matchesSearch =
      session.name.toLowerCase().includes(search.toLowerCase()) ||
      session.id.toLowerCase().includes(search.toLowerCase())

    const matchesFilter = filter === "all" || session.status === filter

    return matchesSearch && matchesFilter
  })

  const sessionCounts = {
    all: sessions.length,
    active: sessions.filter((s: any) => s.status === "active").length,
    idle: sessions.filter((s: any) => s.status === "idle").length,
    error: sessions.filter((s: any) => s.status === "error").length,
  }

  const FilterChip = ({ value, label }: { value: typeof filter; label: string }) => (
    <Pressable
      onPress={() => {
        setFilter(value)
        light()
      }}
      style={[
        styles.filterChip,
        {
          backgroundColor: filter === value ? theme.colors.primary : theme.colors.surfaceVariant,
        },
      ]}
    >
      <Text
        style={[
          styles.filterText,
          {
            color: filter === value ? theme.colors.onPrimary : theme.colors.onSurfaceVariant,
          },
        ]}
      >
        {label} ({sessionCounts[value]})
      </Text>
    </Pressable>
  )

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>Sessions</Text>

        <View style={styles.searchContainer}>
          <Search size={20} color={theme.colors.onSurfaceVariant} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.onSurface }]}
            placeholder="Search sessions..."
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

        <View style={styles.filterRow}>
          <FilterChip value="all" label="All" />
          <FilterChip value="active" label="Active" />
          <FilterChip value="idle" label="Idle" />
          <FilterChip value="error" label="Error" />
        </View>
      </View>

      <FlatList
        data={filteredSessions}
        renderItem={({ item }: { item: any }) => (
          <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }}>
            <SessionCard session={item} />
          </MotiView>
        )}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            icon={<Text style={{ fontSize: 48 }}>📭</Text>}
            title="No sessions found"
            description={search ? "Try a different search term" : "No sessions match the current filter"}
          />
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
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#000f",
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
  filterRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "500",
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },
})
