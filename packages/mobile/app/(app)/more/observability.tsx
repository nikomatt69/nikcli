import { useCallback, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useServer } from "@/lib/server-context"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"
import type { FusionPreset, ObservabilityStatus } from "@/lib/types"

export default function ObservabilityScreen() {
  const { palette } = useAppTheme()
  const { client } = useServer()
  const [status, setStatus] = useState<ObservabilityStatus | null>(null)
  const [presets, setPresets] = useState<FusionPreset[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setError(null)
      const [next, fusion] = await Promise.all([
        client.getObservability(),
        client.listFusionPresets().catch(() => ({ presets: [] })),
      ])
      setStatus(next)
      setPresets(fusion.presets)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function toggleTelemetry() {
    if (!client || !status) return
    try {
      setBusy("otel")
      setStatus(await client.setObservability(!status.enabled))
      void triggerHaptic("success")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  async function toggleFusion(preset: FusionPreset) {
    if (!client) return
    try {
      setBusy(preset.name)
      await client.setFusionPreset(preset.name, !preset.enabled)
      await load()
      void triggerHaptic("selection")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 36, gap: 16 }}
    >
      {error ? <ErrorBanner message={error} /> : null}
      <SurfaceCard
        eyebrow="OpenTelemetry"
        title="Host telemetry"
        description="Spans export only when OTEL_EXPORTER_OTLP_ENDPOINT is set on the host."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={status?.enabled ? "Enabled" : "Disabled"} tone={status?.enabled ? "good" : "neutral"} />
          <InfoChip label={status?.otlpEndpoint ? "OTLP configured" : "No OTLP endpoint"} />
        </View>
        {status?.otlpEndpoint ? (
          <Text selectable style={{ marginTop: 12, color: palette.soft, ...typeStyle(12) }}>
            {status.otlpEndpoint}
          </Text>
        ) : null}
        <View className="mt-4">
          <ActionButton
            label={status?.enabled ? "Disable telemetry" : "Enable telemetry"}
            loading={busy === "otel"}
            onPress={() => void toggleTelemetry()}
          />
        </View>
      </SurfaceCard>

      <SurfaceCard eyebrow="Models" title="Fusion presets" description="OpenRouter Fusion variants on the host.">
        <View className="gap-3">
          {presets.map((preset) => (
            <View key={preset.name} className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text selectable style={{ color: palette.ink, ...typeStyle(14, { weight: "600" }) }}>
                  {preset.name}
                </Text>
                <Text style={{ color: palette.soft, ...typeStyle(12) }}>{preset.builtin ? "Built-in" : "Custom"}</Text>
              </View>
              <ActionButton
                label={preset.enabled ? "On" : "Off"}
                variant={preset.enabled ? "secondary" : "ghost"}
                loading={busy === preset.name}
                onPress={() => void toggleFusion(preset)}
              />
            </View>
          ))}
          {!presets.length ? (
            <EmptyState title="No Fusion presets" description="This host has no OpenRouter Fusion presets yet." />
          ) : null}
        </View>
      </SurfaceCard>
    </ScrollView>
  )
}
