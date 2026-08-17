import { useCallback, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useServer } from "@/lib/server-context"
import { triggerHaptic } from "@/lib/haptics"
import type { HostCapability } from "@/lib/types"

function bytes(value?: number) {
  if (!value) return "—"
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export default function HostStatusScreen() {
  const { client } = useServer()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [browser, setBrowser] = useState<HostCapability<{ sessions?: unknown[] }> | null>(null)
  const [computer, setComputer] = useState<HostCapability<{
    platform?: string
    screenshot?: boolean
    input?: boolean
    detail?: string
  }> | null>(null)
  const [herdr, setHerdr] = useState<HostCapability<{ enabled?: boolean }> | null>(null)
  const [island, setIsland] = useState<
    HostCapability<{ supported?: boolean; enabled?: boolean; appRunning?: boolean; sessions?: number }> | null
  >(null)
  const [devtools, setDevtools] = useState<
    HostCapability<{ rss?: number; heapUsed?: number; pid?: number; uptimeSec?: number; platform?: string }> | null
  >(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setError(null)
      const [nextBrowser, nextComputer, nextHerdr, nextIsland, nextDevtools] = await Promise.all([
        client.getHostBrowser(),
        client.getHostComputer(),
        client.getHostHerdr(),
        client.getHostIsland(),
        client.getHostDevtools(),
      ])
      setBrowser(nextBrowser)
      setComputer(nextComputer)
      setHerdr(nextHerdr)
      setIsland(nextIsland)
      setDevtools(nextDevtools)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function toggleHerdr() {
    if (!client || !herdr) return
    try {
      setBusy(true)
      setHerdr(await client.setHostHerdr(!herdr.enabled))
      void triggerHaptic("success")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 36, gap: 16 }}
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Text className="px-1 text-[13px] leading-[19px] text-soft">
        These controls report the linked host. They do not drive this phone.
      </Text>

      <SurfaceCard eyebrow="Browser" title="Browser control">
        <InfoChip
          label={browser?.available ? `${browser.sessions?.length ?? 0} sessions` : (browser?.reason ?? "Unavailable")}
          tone={browser?.available ? "good" : "neutral"}
        />
      </SurfaceCard>

      <SurfaceCard eyebrow="Desktop" title="Computer use">
        {computer?.available ? (
          <View className="gap-2">
            <InfoChip label={computer.platform ?? "unknown"} />
            <InfoChip label={computer.screenshot ? "Screenshot" : "No screenshot"} tone={computer.screenshot ? "good" : "warn"} />
            <InfoChip label={computer.input ? "Input" : "No input"} tone={computer.input ? "good" : "warn"} />
            {computer.detail ? <Text className="text-[12px] leading-[17px] text-soft">{computer.detail}</Text> : null}
          </View>
        ) : (
          <InfoChip label={computer?.reason ?? "Unavailable"} />
        )}
      </SurfaceCard>

      <SurfaceCard eyebrow="Integrations" title="Herdr">
        <InfoChip label={herdr?.available ? (herdr.enabled ? "Enabled" : "Disabled") : (herdr?.reason ?? "Unavailable")} />
        {herdr?.available ? (
          <View className="mt-4">
            <ActionButton
              label={herdr.enabled ? "Disable bridge" : "Enable bridge"}
              loading={busy}
              onPress={() => void toggleHerdr()}
            />
          </View>
        ) : null}
      </SurfaceCard>

      <SurfaceCard eyebrow="macOS" title="Island">
        <InfoChip
          label={
            island?.available
              ? island.appRunning
                ? `${island.sessions ?? 0} live sessions`
                : "App not running"
              : (island?.reason ?? "Unavailable")
          }
        />
      </SurfaceCard>

      <SurfaceCard eyebrow="Runtime" title="Host process">
        {devtools?.available ? (
          <View className="flex-row flex-wrap gap-2">
            <InfoChip label={`RSS ${bytes(devtools.rss)}`} />
            <InfoChip label={`Heap ${bytes(devtools.heapUsed)}`} />
            <InfoChip label={`pid ${devtools.pid ?? "—"}`} />
            <InfoChip label={`${devtools.uptimeSec ?? 0}s up`} />
          </View>
        ) : (
          <InfoChip label={devtools?.reason ?? "Unavailable"} />
        )}
      </SurfaceCard>
    </ScrollView>
  )
}
