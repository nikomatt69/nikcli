import { memo, useCallback, useMemo, useState } from "react"
import { RefreshControl, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import { router, useFocusEffect, type Href } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { AppHeader } from "@/components/layout/AppHeader"
import { ScreenBrandHeader, SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { useHostEvents } from "@/hooks/use-host-events"
import { useServer } from "@/lib/server-context"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import type { MissionDefinition, MissionRuntime, MissionRuntimeStatus } from "@/lib/types"
import { relativeTime } from "@/lib/types"

function statusTone(status: MissionRuntimeStatus): "neutral" | "accent" | "good" | "warn" {
  if (status === "running" || status === "cancelling") return "accent"
  if (status === "error" || status === "paused") return "warn"
  return "good"
}

const MissionRow = memo(function MissionRow({
  mission,
  runtime,
  starting,
  onStart,
}: {
  mission: MissionDefinition
  runtime: MissionRuntime
  starting: boolean
  onStart(id: string): void
}) {
  const progress =
    runtime.totalFeatures > 0
      ? `${runtime.doneFeatures}/${runtime.totalFeatures} features`
      : `${mission.milestones.length} milestones`

  return (
    <SurfaceCard
      eyebrow={runtime.lastRunAt ? `Last run ${relativeTime(runtime.lastRunAt)}` : mission.status}
      title={mission.name}
      description={mission.brief}
    >
      <View className="flex-row flex-wrap gap-2">
        <InfoChip label={runtime.status} tone={statusTone(runtime.status)} />
        <InfoChip label={progress} tone="neutral" />
        {runtime.sessionID ? <InfoChip label="Has session" tone="accent" /> : null}
      </View>
      <View className="mt-4 flex-row gap-3">
        <View className="flex-1">
          <ActionButton
            label={runtime.status === "running" ? "Running" : "Start"}
            loading={starting || runtime.status === "running"}
            disabled={runtime.status === "paused"}
            onPress={() => onStart(mission.id)}
            variant="secondary"
          />
        </View>
        <View className="flex-1">
          <ActionButton
            label="Manage"
            variant="secondary"
            onPress={() => router.push(`/more/missions/${mission.id}` as Href)}
          />
        </View>
      </View>
    </SurfaceCard>
  )
})

export default function MissionsScreen() {
  const { palette } = useAppTheme()
  const { client, config } = useServer()
  const [missions, setMissions] = useState<MissionDefinition[]>([])
  const [runtimes, setRuntimes] = useState<Record<string, MissionRuntime>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [startingID, setStartingID] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!client) {
        setMissions([])
        setRuntimes({})
        return
      }
      try {
        if (!silent) setRefreshing(true)
        setError(null)
        const result = await client.listMissions()
        setMissions(result.missions)
        setRuntimes(Object.fromEntries(result.runtimes.map((runtime) => [runtime.missionID, runtime])))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!silent) setRefreshing(false)
      }
    },
    [client],
  )

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useHostEvents({
    config,
    enabled: Boolean(client),
    onEvent: (event) => {
      if (event.type.startsWith("mission.")) void load(true)
    },
  })

  async function startMission(id: string) {
    if (!client || startingID) return
    try {
      setStartingID(id)
      setError(null)
      await client.startMission(id)
      void triggerHaptic("success")
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void triggerHaptic("error")
    } finally {
      setStartingID(null)
    }
  }

  const runtimeFor = useCallback(
    (id: string): MissionRuntime =>
      runtimes[id] ?? {
        missionID: id,
        status: "idle",
        doneFeatures: 0,
        totalFeatures: 0,
      },
    [runtimes],
  )

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={palette.accent} />,
    [load, palette.accent, refreshing],
  )

  const runningCount = Object.values(runtimes).filter(
    (runtime) => runtime.status === "running" || runtime.status === "cancelling",
  ).length

  const hero = (
    <View style={{ gap: 12 }}>
      <ScreenBrandHeader title="Missions" right={<SettingsCircleButton />} />
      <AppHeader
        className="gap-3 pb-4"
        chips={[
          { label: `${missions.length} missions`, tone: "accent" },
          runningCount > 0 ? { label: `${runningCount} running`, tone: "accent" } : null,
        ]}
      >
        <ActionButton label="New mission" onPress={() => router.push("/more/missions/new" as Href)} />
        {error ? <ErrorBanner message={error} /> : null}
      </AppHeader>
    </View>
  )

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        data={missions}
        keyExtractor={(mission) => mission.id}
        refreshControl={refreshControl}
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => (
          <MissionRow
            mission={item}
            runtime={runtimeFor(item.id)}
            starting={startingID === item.id}
            onStart={startMission}
          />
        )}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <EmptyState
            title="No missions yet"
            description="Create a mission to orchestrate milestones and features on the linked host."
            action={<ActionButton label="Create mission" onPress={() => router.push("/more/missions/new" as Href)} />}
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />
    </View>
  )
}
