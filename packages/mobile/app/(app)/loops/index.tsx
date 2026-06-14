import { useCallback, useMemo, useState } from "react"
import { FlatList, RefreshControl, View } from "react-native"
import { router, useFocusEffect, type Href } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { AppHeader } from "@/components/layout/AppHeader"
import { useServer } from "@/lib/server-context"
import { useAppTheme } from "@/lib/theme"
import type { LoopDefinition, LoopRuntime, LoopRuntimeStatus } from "@/lib/types"
import { relativeTime } from "@/lib/types"

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function scheduleLabel(loop: LoopDefinition): string {
  return loop.trigger.kind === "interval" ? `Every ${formatDuration(loop.trigger.everyMs)}` : "Manual"
}

function statusTone(status: LoopRuntimeStatus): "neutral" | "accent" | "good" | "warn" {
  if (status === "running" || status === "cancelling") return "accent"
  if (status === "error" || status === "paused") return "warn"
  return "good"
}

function LoopRow({
  loop,
  runtime,
  running,
  onRun,
}: {
  loop: LoopDefinition
  runtime: LoopRuntime
  running: boolean
  onRun: (id: string) => void
}) {
  const description = loop.stages.map((stage) => stage.name).join(" → ")

  return (
    <SurfaceCard
      eyebrow={runtime.lastRunAt ? `Last run ${relativeTime(runtime.lastRunAt)}` : "Never run"}
      title={loop.name}
      description={description}
    >
      <View className="flex-row flex-wrap gap-2">
        <InfoChip label={runtime.status} tone={statusTone(runtime.status)} />
        <InfoChip label={loop.enabled ? "Enabled" : "Disabled"} tone={loop.enabled ? "good" : "neutral"} />
        <InfoChip label={scheduleLabel(loop)} tone="neutral" />
        <InfoChip label={`${loop.stages.length} stage${loop.stages.length === 1 ? "" : "s"}`} tone="neutral" />
        {runtime.runs > 0 ? <InfoChip label={`${runtime.runs} runs`} tone="neutral" /> : null}
      </View>
      <View className="mt-4 flex-row gap-3">
        <View className="flex-1">
          <ActionButton
            label={runtime.status === "running" ? "Running" : "Run now"}
            loading={running || runtime.status === "running"}
            disabled={!loop.enabled || runtime.status === "paused"}
            onPress={() => onRun(loop.id)}
            variant="secondary"
          />
        </View>
        <View className="flex-1">
          <ActionButton label="Manage" variant="secondary" onPress={() => router.push(`/loops/${loop.id}` as Href)} />
        </View>
      </View>
    </SurfaceCard>
  )
}

export default function LoopsScreen() {
  const { palette } = useAppTheme()
  const { client } = useServer()
  const [loops, setLoops] = useState<LoopDefinition[]>([])
  const [runtimes, setRuntimes] = useState<Record<string, LoopRuntime>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [runningID, setRunningID] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!client) {
        setLoops([])
        setRuntimes({})
        return
      }
      try {
        if (!silent) setRefreshing(true)
        setError(null)
        const result = await client.listLoops()
        setLoops(result.loops)
        setRuntimes(Object.fromEntries(result.runtimes.map((runtime) => [runtime.loopID, runtime])))
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
      const interval = setInterval(() => void load(true), 5_000)
      return () => clearInterval(interval)
    }, [load]),
  )

  async function runLoop(id: string) {
    if (!client || runningID) return
    try {
      setRunningID(id)
      setError(null)
      await client.runLoop(id)
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunningID(null)
    }
  }

  const runtimeFor = useCallback(
    (id: string): LoopRuntime =>
      runtimes[id] ?? {
        loopID: id,
        status: "idle",
        runs: 0,
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
    <AppHeader
      chips={[
        { label: `${loops.length} loops`, tone: "accent" },
        { label: `${loops.filter((loop) => loop.enabled).length} enabled`, tone: "good" },
        runningCount > 0 ? { label: `${runningCount} running`, tone: "accent" } : null,
      ]}
    >
      <ActionButton label="New loop" onPress={() => router.push("/loops/new" as Href)} />
      {error ? <ErrorBanner message={error} /> : null}
    </AppHeader>
  )

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={loops}
        keyExtractor={(loop) => loop.id}
        refreshControl={refreshControl}
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => (
          <LoopRow loop={item} runtime={runtimeFor(item.id)} running={runningID === item.id} onRun={runLoop} />
        )}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <EmptyState
            title="No loops yet"
            description="Create a loop to run one or more goal-driven stages manually or on an interval."
            action={<ActionButton label="Create loop" onPress={() => router.push("/loops/new" as Href)} />}
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />
    </View>
  )
}
