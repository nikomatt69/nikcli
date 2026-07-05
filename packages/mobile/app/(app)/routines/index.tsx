import { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, RefreshControl, Text, View } from "react-native"
import { router, type Href } from "expo-router"
import { Play } from "lucide-react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { Divider } from "@/components/ui/Divider"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { IconCircleButton } from "@/components/ui/IconCircleButton"
import { ListRow, StatusDot } from "@/components/ui/ListRow"
import { AppHeader } from "@/components/layout/AppHeader"
import { ScreenBrandHeader, SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import type { Routine } from "@/lib/types"
import { relativeTime } from "@/lib/types"

function triggerSummary(routine: Routine): string {
  const parts: string[] = []
  for (const t of routine.triggers) {
    if (!t.enabled) continue
    if (t.type === "schedule") parts.push(t.cron)
    if (t.type === "api") parts.push("API")
  }
  return parts.length > 0 ? parts.join(" · ") : "manual only"
}

function RoutineRow({ item, onRun, running }: { item: Routine; onRun: (id: string) => void; running: boolean }) {
  const { palette } = useAppTheme()

  const subtitle = [
    item.paused ? "Paused" : triggerSummary(item),
    item.lastRunAt ? `ran ${relativeTime(item.lastRunAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <ListRow
      leading={<StatusDot color={item.paused ? hexToRgba(palette.ink, 0.25) : palette.success} />}
      title={item.name}
      subtitle={subtitle}
      onPress={() => router.push(`/routines/${item.id}` as Href)}
      trailing={
        <IconCircleButton
          size={34}
          accessibilityLabel={`Run ${item.name} now`}
          onPress={() => onRun(item.id)}
          disabled={running}
        >
          <Play size={14} color={running ? palette.muted : palette.ink} strokeWidth={2.2} />
        </IconCircleButton>
      }
    />
  )
}

export default function RoutinesScreen() {
  const { palette } = useAppTheme()
  const { client } = useServer()
  const [routines, setRoutines] = useState<Routine[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runningID, setRunningID] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) {
      setRoutines([])
      return
    }
    try {
      setRefreshing(true)
      setError(null)
      setRoutines(await client.listRoutines())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const refreshControlElement = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={palette.muted} />,
    [refreshing, load, palette.muted],
  )

  async function runRoutine(id: string) {
    if (!client || runningID) return
    try {
      setRunningID(id)
      setError(null)
      const session = await client.runRoutine(id)
      router.push(`/sessions/${session.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunningID(null)
    }
  }

  const activeCount = routines.filter((r) => !r.paused).length

  const hero = (
    <AppHeader className="gap-3 pb-4">
      <ScreenBrandHeader title="Routines" right={<SettingsCircleButton />} />
      <ActionButton label="New routine" onPress={() => router.push("/routines/new" as Href)} />
      {routines.length > 0 ? (
        <Text className="text-[13px] text-muted">
          {routines.length} {routines.length === 1 ? "routine" : "routines"} · {activeCount} active
        </Text>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
    </AppHeader>
  )

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={routines}
        keyExtractor={(item) => item.id}
        refreshControl={refreshControlElement}
        ItemSeparatorComponent={() => <Divider inset={24} />}
        renderItem={({ item }) => <RoutineRow item={item} onRun={runRoutine} running={runningID === item.id} />}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <EmptyState
            title="No routines yet"
            description="Create a routine for work that runs on a schedule, through the API, or on demand."
            action={<ActionButton label="Create routine" onPress={() => router.push("/routines/new" as Href)} />}
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />
    </View>
  )
}
