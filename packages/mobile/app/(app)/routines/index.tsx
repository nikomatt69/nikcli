import { useCallback, useEffect, useState } from "react"
import { FlatList, RefreshControl, View } from "react-native"
import { Link, router, type Href } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import type { Routine } from "@/lib/types"
import { relativeTime } from "@/lib/text-utils"

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
  return (
    <SurfaceCard
      eyebrow={relativeTime(item.updatedAt)}
      title={item.name}
      description={item.prompt.slice(0, 120) + (item.prompt.length > 120 ? "…" : "")}
    >
      <View className="flex-row flex-wrap gap-2">
        <InfoChip label={item.paused ? "Paused" : "Active"} tone={item.paused ? "warn" : "good"} />
        <InfoChip label={triggerSummary(item)} tone="neutral" />
        {item.lastRunAt ? <InfoChip label={`Last run ${relativeTime(item.lastRunAt)}`} tone="neutral" /> : null}
      </View>
      <View className="mt-4 flex-row gap-3">
        <ActionButton label="Run now" loading={running} onPress={() => onRun(item.id)} variant="secondary" />
        <Link href={`/routines/${item.id}` as Href} asChild>
          <ActionButton label="Edit" variant="secondary" onPress={() => {}} />
        </Link>
      </View>
    </SurfaceCard>
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

  const hero = (
    <View className="pb-5">
      <SurfaceCard
        eyebrow="Automation"
        title="Scheduled & triggered workflows"
        description="Create routines with prompts that run on a schedule, via API webhook, or on demand. Each run spawns a new session."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${routines.length} routines`} tone="accent" />
          <InfoChip
            label={`${routines.filter((r) => !r.paused).length} active`}
            tone={routines.some((r) => !r.paused) ? "good" : "neutral"}
          />
          <InfoChip
            label={`${routines.filter((r) => r.paused).length} paused`}
            tone={routines.some((r) => r.paused) ? "warn" : "neutral"}
          />
        </View>
        <View className="mt-4">
          <ActionButton label="New routine" onPress={() => router.push("/routines/new" as Href)} />
        </View>
      </SurfaceCard>
      {error ? (
        <View className="mt-4">
          <ErrorBanner message={error} />
        </View>
      ) : null}
    </View>
  )

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={routines}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={palette.accent} />
        }
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => <RoutineRow item={item} onRun={runRoutine} running={runningID === item.id} />}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <EmptyState
            title="No routines yet"
            description="Create your first routine to automate recurring AI tasks. Run on a cron schedule, via API webhook, or trigger manually."
            action={<ActionButton label="Create routine" onPress={() => router.push("/routines/new" as Href)} />}
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />
    </View>
  )
}
