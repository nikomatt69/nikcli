import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Pressable, RefreshControl, SectionList, Text, View } from "react-native"
import { router, useRootNavigationState, type Href } from "expo-router"
import { Check, Funnel, Menu } from "lucide-react-native"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { WorkspaceSwitcherSheet } from "@/components/session/WorkspaceSwitcherSheet"
import { SessionListItem } from "@/components/SessionListItem"
import { SessionListSkeleton } from "@/components/SessionListSkeleton"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { FloatingDock } from "@/components/ui/FloatingDock"
import { IconCircleButton } from "@/components/ui/IconCircleButton"
import { AppHeader } from "@/components/layout/AppHeader"
import { CenteredScreenHeader } from "@/components/layout/CenteredScreenHeader"
import { AppMenuSheet } from "@/components/layout/AppMenuSheet"
import { DeviceSection, formatHostLabel } from "@/components/session/DeviceSection"
import { useServer } from "@/lib/server-context"
import { getSessionSeen, setSessionSeen } from "@/lib/storage"
import { usePressAnimation } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"
import type { SessionSummary } from "@/lib/types"

type SessionSection = {
  title: string
  data: SessionSummary[]
}

type SessionFilter = "all" | "running" | "interrupted" | "changes"

const FILTERS: Array<{ id: SessionFilter; label: string; description: string }> = [
  { id: "all", label: "All sessions", description: "Everything on this host" },
  { id: "running", label: "Running", description: "Agents currently working" },
  { id: "interrupted", label: "Interrupted", description: "Needs attention" },
  { id: "changes", label: "With changes", description: "Sessions that touched files" },
]

function matchesFilter(item: SessionSummary, filter: SessionFilter): boolean {
  if (filter === "all") return true
  if (filter === "running") return item.status?.type === "busy"
  if (filter === "interrupted") return item.status?.type === "retry"
  const summary = item.info.summary
  return (summary?.additions ?? 0) + (summary?.deletions ?? 0) > 0
}

function FilterRow({
  label,
  description,
  selected,
  onPress,
}: {
  label: string
  description: string
  selected: boolean
  onPress(): void
}) {
  const { palette } = useAppTheme()
  const [pressed, setPressed] = useState(false)
  const press = usePressAnimation()

  return (
    <Animated.View style={{ alignSelf: "stretch", transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true)
          press.onPressIn()
        }}
        onPressOut={() => {
          setPressed(false)
          press.onPressOut()
        }}
        style={{ alignSelf: "stretch" }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "stretch",
            gap: 14,
            minHeight: 64,
            paddingHorizontal: 20,
            opacity: pressed ? 0.72 : 1,
          }}
        >
          <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <Text style={{ color: palette.ink, ...typeStyle(16, { weight: "600" }) }}>{label}</Text>
            <Text style={{ color: palette.muted, marginTop: 2, ...typeStyle(13) }}>{description}</Text>
          </View>
          <View style={{ width: 22, alignItems: "flex-end", flexShrink: 0 }}>
            {selected ? <Check size={18} color={palette.ink} strokeWidth={2.4} /> : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

export default function SessionsScreen() {
  const { palette } = useAppTheme()
  const { client, loading, bootstrapLoading, config, bootstrap, save } = useServer()
  const rootNavigationState = useRootNavigationState()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [switchingDirectory, setSwitchingDirectory] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<SessionFilter>("all")
  const [seen, setSeen] = useState<Record<string, number>>({})
  const [seenReady, setSeenReady] = useState(false)
  const searchRef = useRef(search)
  const workspaceSheetRef = useRef<ActionSheetRef>(null)
  const menuSheetRef = useRef<ActionSheetRef>(null)
  const filterSheetRef = useRef<ActionSheetRef>(null)
  const seededSeen = useRef(false)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  useEffect(() => {
    void getSessionSeen().then((value) => {
      setSeen(value)
      setSeenReady(true)
    })
  }, [])

  const load = useCallback(
    async (term?: string, refresh = false) => {
      if (!client) {
        setSessions([])
        setError(null)
        return
      }

      try {
        if (refresh) setRefreshing(true)
        setError(null)
        setSessions(await client.listSessions(term?.trim() || undefined))
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        if (refresh) setRefreshing(false)
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
    void load(searchRef.current)
  }, [config, loading, load, rootNavigationState?.key])

  // First visit: treat whatever is already on the host as read, so historical
  // sessions do not all light up as new.
  useEffect(() => {
    if (!seenReady || seededSeen.current || sessions.length === 0) return
    if (Object.keys(seen).length > 0) {
      seededSeen.current = true
      return
    }
    seededSeen.current = true
    const seed: Record<string, number> = {}
    for (const session of sessions) seed[session.info.id] = session.info.time.updated
    setSeen(seed)
    void setSessionSeen(seed)
  }, [seen, seenReady, sessions])

  const refreshControlElement = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => void load(searchRef.current, true)} tintColor={palette.muted} />,
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
      const session = await client.createSession({
        title: "Mobile session",
        executionTarget,
      })
      router.push(`/sessions/${session.id}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setCreating(false)
    }
  }

  async function switchWorkspace(directory: string) {
    if (!config || directory === config.directory) {
      workspaceSheetRef.current?.dismiss()
      return
    }
    try {
      setSwitchingDirectory(directory)
      setError(null)
      await save({ ...config, directory })
      workspaceSheetRef.current?.dismiss()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSwitchingDirectory(null)
    }
  }

  const projects = bootstrap?.projects ?? []
  const visibleSessions = useMemo(
    () =>
      sessions
        .filter((item) => matchesFilter(item, filter))
        .sort((a, b) => b.info.time.updated - a.info.time.updated),
    [filter, sessions],
  )
  const sections: SessionSection[] = useMemo(
    () => (visibleSessions.length === 0 ? [] : [{ title: "Sessions", data: visibleSessions }]),
    [visibleSessions],
  )

  const hero = (
    <AppHeader className="gap-4 pb-2">
      <CenteredScreenHeader
        title="Code"
        left={
          <IconCircleButton
            size={44}
            accessibilityLabel="Open menu"
            accessibilityHint="Workspaces, terminal, tools, and settings"
            onPress={() => menuSheetRef.current?.present()}
          >
            <Menu size={20} color={palette.ink} strokeWidth={2} />
          </IconCircleButton>
        }
        right={
          <IconCircleButton
            size={44}
            tone="warm"
            accessibilityLabel={filter === "all" ? "Filter sessions" : `Filter sessions, ${filter}`}
            accessibilityHint="Shows running, interrupted, or changed sessions"
            onPress={() => filterSheetRef.current?.present()}
          >
            <Funnel size={18} color={palette.ink} strokeWidth={2.2} fill={filter === "all" ? "none" : palette.ink} />
          </IconCircleButton>
        }
      />
      <DeviceSection url={config?.url} connected={Boolean(bootstrap)} version={bootstrap?.version} />
      {error ? <ErrorBanner message={error} /> : null}
    </AppHeader>
  )

  if ((loading || bootstrapLoading) && sessions.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <View className="flex-1 px-4 pt-4">
          {hero}
          <SessionListSkeleton />
        </View>
        <FloatingDock
          actionLabel="New session"
          onAction={() => void createSession()}
          actionLoading={creating}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Filter sessions"
          bottomInset={54}
        />
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
        renderSectionHeader={({ section }) =>
          section.data.length === 0 ? null : (
            <Text
              style={{
                color: palette.muted,
                paddingTop: 18,
                paddingBottom: 6,
                paddingHorizontal: 4,
                ...typeStyle(15, { weight: "500" }),
              }}
            >
              {section.title}
            </Text>
          )
        }
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: 1,
              marginLeft: 32,
              backgroundColor: hexToRgba(palette.ink, 0.06),
            }}
          />
        )}
        renderItem={({ item }) => {
          const lastSeen = seen[item.info.id]
          const unread = lastSeen === undefined || item.info.time.updated > lastSeen
          const isNew = lastSeen === undefined
          return (
            <SessionListItem
              item={item}
              unread={unread}
              isNew={isNew}
              locationFallback={config?.directory}
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
          )
        }}
        ListHeaderComponent={hero}
        extraData={{ seen, filter, search }}
        ListEmptyComponent={
          loading || bootstrapLoading ? (
            <SessionListSkeleton />
          ) : search.trim() ? (
            <EmptyState
              title="No matches"
              description={`Nothing matches “${search.trim()}”.`}
              action={<ActionButton label="Clear search" variant="secondary" onPress={() => setSearch("")} />}
            />
          ) : filter !== "all" ? (
            <EmptyState
              title={`No ${FILTERS.find((item) => item.id === filter)?.label.toLowerCase() ?? "matching sessions"}`}
              description="Try another filter, or show everything on this host."
              action={<ActionButton label="Show all" variant="secondary" onPress={() => setFilter("all")} />}
            />
          ) : (
            <EmptyState
              title="No sessions yet"
              description="Start a session to run work, review diffs, and answer permission prompts."
              action={
                <View className="gap-2">
                  <ActionButton label="Start a session" loading={creating} onPress={() => void createSession()} />
                  <ActionButton
                    label="New mission"
                    variant="secondary"
                    onPress={() => router.push("/more/missions/new" as Href)}
                  />
                </View>
              }
            />
          )
        }
        style={{ paddingHorizontal: 16 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 196, flexGrow: 1 }}
      />
      <FloatingDock
        actionLabel="New session"
        onAction={() => void createSession()}
        actionLoading={creating}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Filter sessions"
        bottomInset={54}
      />
      <WorkspaceSwitcherSheet
        sheetRef={workspaceSheetRef}
        projects={projects}
        selectedDirectory={config?.directory}
        switchingDirectory={switchingDirectory}
        onSelect={(directory) => void switchWorkspace(directory)}
      />
      <AppMenuSheet
        sheetRef={menuSheetRef}
        hostLabel={formatHostLabel(config?.url)}
        connected={Boolean(bootstrap)}
        version={bootstrap?.version}
        onChangeWorkspace={() => workspaceSheetRef.current?.present()}
      />
      <ActionSheet ref={filterSheetRef} snapPoints={[420]}>
        <View style={{ alignSelf: "stretch", width: "100%", paddingBottom: 28 }}>
          <Text
            style={{
              color: palette.muted,
              paddingHorizontal: 20,
              paddingBottom: 8,
              ...typeStyle(12, { weight: "500" }),
            }}
          >
            Filter
          </Text>
          {FILTERS.map((item) => (
            <FilterRow
              key={item.id}
              label={item.label}
              description={item.description}
              selected={filter === item.id}
              onPress={() => {
                setFilter(item.id)
                filterSheetRef.current?.dismiss()
              }}
            />
          ))}
        </View>
      </ActionSheet>
    </View>
  )
}
