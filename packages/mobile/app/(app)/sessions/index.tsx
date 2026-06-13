import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlatList, RefreshControl, View } from "react-native"
import { router, useRootNavigationState } from "expo-router"
import { SessionListItem } from "@/components/SessionListItem"
import { SessionListSkeleton } from "@/components/SessionListSkeleton"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { TextField } from "@/components/ui/TextField"
import { AppHeader } from "@/components/layout/AppHeader"
import { useServer } from "@/lib/server-context"
import { useAppTheme } from "@/lib/theme"
import type { SessionSummary } from "@/lib/types"

export default function SessionsScreen() {
  const { palette } = useAppTheme()
  const { client, loading, bootstrapLoading, config, bootstrap } = useServer()
  const rootNavigationState = useRootNavigationState()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  const load = useCallback(
    async (term?: string) => {
      if (!client) {
        setSessions([])
        setError(null)
        return
      }

      try {
        setRefreshing(true)
        setError(null)
        setSessions(await client.listSessions(term?.trim() || undefined))
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setRefreshing(false)
      }
    },
    [client],
  )

  useEffect(() => {
    if (!client) return
    const timer = setTimeout(() => {
      void load(search)
    }, 180)
    return () => clearTimeout(timer)
  }, [client, load, search])

  useEffect(() => {
    if (!rootNavigationState?.key) return
    if (loading) return
    if (!config) {
      router.replace("/")
      return
    }
    // Use ref to avoid search being in deps (first effect handles search debounce)
    void load(searchRef.current)
  }, [config, loading, load, rootNavigationState?.key])

  const refreshControlElement = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={palette.accent} />,
    [refreshing, load, palette.accent],
  )

  async function createSession() {
    if (!client || creating) return
    const executionTarget = config?.executionTarget ?? "local"
    if (executionTarget === "container" && !bootstrap?.execution?.container?.available) {
      setError(
        "Container sandbox is unavailable on the host. Switch back to local in Settings or restore Docker/Podman.",
      )
      return
    }
    try {
      setCreating(true)
      setError(null)
      const session = await client.createSession({ title: "Mobile session", executionTarget })
      router.push(`/sessions/${session.id}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setCreating(false)
    }
  }

  const busyCount = useMemo(() => sessions.filter((item) => item.status?.type === "busy").length, [sessions])
  const retryCount = useMemo(() => sessions.filter((item) => item.status?.type === "retry").length, [sessions])

  const hero = (
    <AppHeader
      chips={[
        { label: `${sessions.length} sessions`, tone: "accent" },
        { label: `${busyCount} busy`, tone: busyCount ? "accent" : "neutral" },
        retryCount ? { label: `${retryCount} need attention`, tone: "warn" } : null,
      ]}
    >
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <TextField
            value={search}
            onChangeText={setSearch}
            placeholder="Search sessions"
            autoCapitalize="none"
          />
        </View>
        <View className="w-[132px]">
          <ActionButton label="New session" loading={creating} onPress={() => void createSession()} />
        </View>
      </View>
      {error ? (
        <ErrorBanner message={error} />
      ) : null}
    </AppHeader>
  )

  if ((loading || bootstrapLoading) && sessions.length === 0) {
    return (
      <View className="flex-1 bg-background px-4 pt-4">
        {hero}
        <SessionListSkeleton />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={sessions}
        keyExtractor={(item) => item.info.id}
        refreshControl={refreshControlElement}
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item, index }) => (
          <SessionListItem
            item={item}
            index={index}
            onPress={() => router.push(`/sessions/${item.info.id}`)}
            onStop={async () => {
              if (!client) return
              try {
                await client.abortSession(item.info.id)
                void load(searchRef.current)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
            onDelete={async () => {
              if (!client) return
              setSessions((prev) => prev.filter((s) => s.info.id !== item.info.id))
              try {
                await client.deleteSession(item.info.id)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
                void load(searchRef.current)
              }
            }}
          />
        )}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <EmptyState
            title="No sessions yet"
            description="Create a session to run work, review diffs, and answer permission prompts."
            action={
              <ActionButton label="Create local session" loading={creating} onPress={() => void createSession()} />
            }
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />
    </View>
  )
}
