import { useCallback, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { router, useFocusEffect, type Href } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useServer } from "@/lib/server-context"
import { triggerHaptic } from "@/lib/haptics"
import type { BrainStatus } from "@/lib/types"
import { relativeTime } from "@/lib/types"

export default function BrainScreen() {
  const { client } = useServer()
  const [status, setStatus] = useState<BrainStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setError(null)
      setStatus(await client.getBrainStatus())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function trigger() {
    if (!client) return
    try {
      setRunning(true)
      setError(null)
      const result = await client.triggerBrain(true)
      void triggerHaptic(result.success ? "success" : "error")
      if (!result.success) {
        setError(result.error ?? "Brain failed")
        return
      }
      await load()
      if (result.sessionID) router.push(`/sessions/${result.sessionID}` as Href)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void triggerHaptic("error")
    } finally {
      setRunning(false)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 36, gap: 16 }}
    >
      {error ? <ErrorBanner message={error} /> : null}
      <SurfaceCard
        eyebrow="Memory"
        title="Brain"
        description="The host reviews recent sessions and writes durable memory. This runs on the linked machine."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={status?.enabled ? "Enabled" : "Disabled"} tone={status?.enabled ? "good" : "neutral"} />
          <InfoChip label={status?.shouldTrigger ? "Due" : "Not due"} tone={status?.shouldTrigger ? "accent" : "neutral"} />
          {status?.lastBrainAt ? <InfoChip label={`Last ${relativeTime(status.lastBrainAt)}`} /> : null}
        </View>
        {status ? (
          <Text className="mt-3 text-[13px] leading-[18px] text-soft">
            {status.sessionsSinceLastBrain} sessions since last run. Threshold {status.minSessions} sessions or{" "}
            {status.minHours} hours.
          </Text>
        ) : null}
        <View className="mt-4">
          <ActionButton label="Run Brain" loading={running} onPress={() => void trigger()} />
        </View>
      </SurfaceCard>
    </ScrollView>
  )
}
