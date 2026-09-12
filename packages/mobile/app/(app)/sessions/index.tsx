import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshControl, SectionList, Text, View } from "react-native"
import { router, useRootNavigationState, type Href } from "expo-router"
import { Folder } from "lucide-react-native"
import { type ActionSheetRef } from "@/components/BottomSheet"
import { WorkspaceSwitcherSheet } from "@/components/session/WorkspaceSwitcherSheet"
import { SessionListItem } from "@/components/SessionListItem"
import { SessionListSkeleton } from "@/components/SessionListSkeleton"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { FloatingDock } from "@/components/ui/FloatingDock"
import { IconCircleButton } from "@/components/ui/IconCircleButton"
import { TipsCard } from "@/components/ui/TipsCard"
import { AppHeader } from "@/components/layout/AppHeader"
import { CenteredScreenHeader } from "@/components/layout/CenteredScreenHeader"
import { SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { DeviceSection } from "@/components/session/DeviceSection"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import type { ProjectInfo, SessionSummary } from "@/lib/types"

type SessionSection = {
  title: string
  data: SessionSummary[]
}

const EMPTY_PROJECTS: ProjectInfo[] = []

function lastPathSegment(path?: string): string {
  if (!path) return "Unknown workspace"
  const segments = path.split("/").filter(Boolean)
  // A root worktree ("/") has no last segment, and a bare "/" reads as nothing
  // at all as a section heading.
  return segments[segments.length - 1] || "Workspace"
}

function projectLabel(project: ProjectInfo): string {
  return project.name || lastPathSegment(project.worktree)
}

function groupSessions(
  sessions: SessionSummary[],
  projects: ProjectInfo[],
  selectedDirectory?: string,
): SessionSection[] {
  const projectsByID = new Map(projects.map((project) => [project.id, project]))
  const buckets = new Map<string, { title: string; selected: boolean; data: SessionSummary[] }>()

  for (const session of sessions) {
    const project = projectsByID.get(session.info.projectID)
    const key = project?.id || session.info.projectID || session.info.directory || "unknown"
    const selected = project
      ? project.worktree === selectedDirectory || project.sandboxes.includes(selectedDirectory || "")
      : session.info.directory === selectedDirectory
    const bucket = buckets.get(key) ?? {
      title: project ? projectLabel(project) : lastPathSegment(session.info.directory),
      selected,
      data: [],
    }
    bucket.selected ||= selected
    bucket.data.push(session)
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .sort((a, b) => Number(b.selected) - Number(a.selected) || a.title.localeCompare(b.title))
    .map(({ title, data }) => ({
      title,
      data: data.sort((a, b) => b.info.time.updated - a.info.time.updated),
    }))
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
  const searchRef = useRef(search)
  const workspaceSheetRef = useRef<ActionSheetRef>(null)
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

  const busyCount = useMemo(() => sessions.filter((item) => item.status?.type === "busy").length, [sessions])
  const projects = bootstrap?.projects ?? EMPTY_PROJECTS
  const sections = useMemo(
    () => groupSessions(sessions, projects, config?.directory),
    [config?.directory, projects, sessions],
  )

  const hero = (
    <AppHeader className="gap-4 pb-2">
      <CenteredScreenHeader
        title="Sessions"
        left={
          // Dimming lives on a wrapper: IconCircleButton owns its own `style`.
          <View style={{ opacity: projects.length === 0 ? 0.5 : 1 }}>
            <IconCircleButton
              size={36}
              accessibilityLabel={`Change workspace. Current workspace: ${lastPathSegment(config?.directory)}`}
              accessibilityHint="Opens the workspace switcher"
              disabled={projects.length === 0}
              onPress={() => workspaceSheetRef.current?.present()}
            >
              <Folder size={17} color={palette.ink} strokeWidth={2} />
            </IconCircleButton>
          </View>
        }
        right={<SettingsCircleButton />}
      />
      <DeviceSection url={config?.url} connected={Boolean(bootstrap)} version={bootstrap?.version} />
      {busyCount > 0 ? (
        <Text className="text-[13px] text-muted">
          {busyCount} {busyCount === 1 ? "agent" : "agents"} working
        </Text>
      ) : null}
      <TipsCard />
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
        }
        style={{ paddingHorizontal: 16 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 188 }}
      />
      <FloatingDock
        actionLabel="New session"
        onAction={() => void createSession()}
        actionLoading={creating}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Filter sessions"
        // Clears the native tab bar so the dock floats above it, not behind it.
        bottomInset={44}
      />
      <WorkspaceSwitcherSheet
        sheetRef={workspaceSheetRef}
        projects={projects}
        selectedDirectory={config?.directory}
        switchingDirectory={switchingDirectory}
        onSelect={(directory) => void switchWorkspace(directory)}
      />
    </View>
  )
}
