import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshControl, SectionList, Text, View } from "react-native"
import { router, useRootNavigationState } from "expo-router"
import { SessionListItem } from "@/components/SessionListItem"
import { SessionListSkeleton } from "@/components/SessionListSkeleton"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { TextField } from "@/components/ui/TextField"
import { AppHeader } from "@/components/layout/AppHeader"
import { ScreenBrandHeader, SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import type { SessionSummary } from "@/lib/types"

type SessionSection = {
  title: string
  data: SessionSummary[]
}

function groupSessions(sessions: SessionSummary[]): SessionSection[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000

  const buckets: Record<string, SessionSummary[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    Earlier: [],
  }
  for (const session of sessions) {
    const updated = session.info.time.updated
    if (updated >= startOfToday) buckets.Today.push(session)
    else if (updated >= startOfYesterday) buckets.Yesterday.push(session)
    else if (updated >= startOfWeek) buckets["This week"].push(session)
    else buckets.Earlier.push(session)
  }
  return Object.entries(buckets)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({ title, data }))
}

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
    () => <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={palette.muted} />,
    [refreshing, load, palette.muted],
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
  const sections = useMemo(() => groupSessions(sessions), [sessions])

  const hero = (
    <AppHeader className="gap-3 pb-4">
      <ScreenBrandHeader title="Sessions" right={<SettingsCircleButton />} />
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <TextField value={search} onChangeText={setSearch} placeholder="Search sessions" autoCapitalize="none" />
        </View>
        <ActionButton
          label="New"
          loading={creating}
          onPress={() => void createSession()}
          className="min-h-[44px] px-5 py-2.5"
        />
      </View>
      {busyCount > 0 ? (
        <Text className="text-[13px] text-muted">
          {busyCount} {busyCount === 1 ? "agent" : "agents"} working
        </Text>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
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
    <View className="flex-1 bg-background">
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(item) => item.info.id}
        refreshControl={refreshControlElement}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text
            className="text-[13px] font-medium text-muted"
            style={{ paddingTop: 18, paddingBottom: 6, paddingHorizontal: 4 }}
          >
            {section.title}
          </Text>
        )}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: 1,
              marginLeft: 24,
              backgroundColor: hexToRgba(palette.ink, 0.06),
            }}
          />
        )}
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
            description="Start a session to run work, review diffs, and answer permission prompts."
            action={<ActionButton label="Start a session" loading={creating} onPress={() => void createSession()} />}
          />
        }
        style={{ paddingHorizontal: 16 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
      />
    </View>
  )
}
