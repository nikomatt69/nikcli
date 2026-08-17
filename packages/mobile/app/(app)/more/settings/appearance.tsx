import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import * as ImagePicker from "expo-image-picker"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useUIStore } from "@/lib/store"
import { setAppPreferencesWith, normalizeWallpaper } from "@/lib/storage"
import { triggerHaptic } from "@/lib/haptics"
import { usePrefersReducedTransparency } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"

const OPACITY_STOPS = [0.12, 0.22, 0.34, 0.48]

export default function AppearanceScreen() {
  const { palette } = useAppTheme()
  const wallpaper = useUIStore((state) => state.wallpaper)
  const mathEnabled = useUIStore((state) => state.mathEnabled)
  const tipsHidden = useUIStore((state) => state.tipsHidden)
  const setWallpaper = useUIStore((state) => state.setWallpaper)
  const setMathEnabled = useUIStore((state) => state.setMathEnabled)
  const setTipsHidden = useUIStore((state) => state.setTipsHidden)
  const reducedTransparency = usePrefersReducedTransparency()
  const [error, setError] = useState<string | null>(null)

  async function persist(next: { wallpaper?: typeof wallpaper; mathEnabled?: boolean; tipsHidden?: boolean }) {
    await setAppPreferencesWith((current) => ({
      ...current,
      wallpaper: next.wallpaper ?? current.wallpaper,
      mathEnabled: next.mathEnabled ?? current.mathEnabled,
      tipsHidden: next.tipsHidden ?? current.tipsHidden,
    }))
  }

  async function pickWallpaper() {
    try {
      setError(null)
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      })
      if (result.canceled || !result.assets[0]?.uri) return
      const next = normalizeWallpaper({ uri: result.assets[0].uri, opacity: wallpaper.opacity, enabled: true })
      setWallpaper(next)
      await persist({ wallpaper: next })
      void triggerHaptic("success")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save wallpaper")
    }
  }

  async function clearWallpaper() {
    const next = normalizeWallpaper({ uri: null, opacity: wallpaper.opacity, enabled: false })
    setWallpaper(next)
    await persist({ wallpaper: next })
  }

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 36, gap: 16 }}
    >
      {error ? <ErrorBanner message={error} /> : null}
      <SurfaceCard
        eyebrow="Session"
        title="Wallpaper"
        description="Sits behind the transcript. Reduced transparency hides it automatically."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip
            label={wallpaper.enabled && wallpaper.uri ? "On" : "Off"}
            tone={wallpaper.enabled ? "good" : "neutral"}
          />
          {reducedTransparency ? <InfoChip label="Reduced transparency" tone="warn" /> : null}
        </View>
        <View className="mt-4 gap-3">
          <Text className="text-[12px] font-medium text-muted">Opacity</Text>
          <View className="flex-row flex-wrap gap-2">
            {OPACITY_STOPS.map((opacity) => {
              const active = Math.abs(wallpaper.opacity - opacity) < 0.03
              return (
                <Pressable
                  key={opacity}
                  onPress={() => {
                    const next = normalizeWallpaper({ ...wallpaper, opacity })
                    setWallpaper(next)
                    void persist({ wallpaper: next })
                    void triggerHaptic("selection")
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: hexToRgba(palette.ink, active ? 0.28 : 0.1),
                    backgroundColor: hexToRgba(palette.ink, active ? 0.1 : 0.04),
                  }}
                >
                  <Text className="text-[12px] font-semibold text-ink">{Math.round(opacity * 100)}%</Text>
                </Pressable>
              )
            })}
          </View>
          <ActionButton label="Choose image" onPress={() => void pickWallpaper()} />
          <ActionButton label="Clear wallpaper" variant="ghost" onPress={() => void clearWallpaper()} />
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Messages"
        title="Math"
        description="Render $LaTeX$ in assistant replies as monospace formulas."
      >
        <ActionButton
          label={mathEnabled ? "Math on" : "Math off"}
          variant={mathEnabled ? "secondary" : "ghost"}
          onPress={() => {
            setMathEnabled(!mathEnabled)
            void persist({ mathEnabled: !mathEnabled })
            void triggerHaptic("selection")
          }}
        />
      </SurfaceCard>

      <SurfaceCard eyebrow="Guidance" title="Tips">
        <ActionButton
          label={tipsHidden ? "Show tips" : "Hide tips"}
          variant="secondary"
          onPress={() => {
            setTipsHidden(!tipsHidden)
            void persist({ tipsHidden: !tipsHidden })
          }}
        />
      </SurfaceCard>
    </ScrollView>
  )
}
