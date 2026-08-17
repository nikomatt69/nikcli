import { Pressable, Text, View } from "react-native"
import { useUIStore } from "@/lib/store"
import { setAppPreferencesWith } from "@/lib/storage"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { nextTip } from "@/lib/tips"

export function TipsCard({ seed }: { seed?: number }) {
  const { palette } = useAppTheme()
  const hidden = useUIStore((state) => state.tipsHidden)
  const setTipsHidden = useUIStore((state) => state.setTipsHidden)
  if (hidden) return null
  const tip = nextTip(seed)

  return (
    <View
      className="px-4 py-3"
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.ink, 0.08),
        backgroundColor: palette.surfaceRaised,
      }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[12px] font-medium text-muted">Tip</Text>
          <Text className="mt-1 text-[13px] leading-[18px] text-ink">{tip}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide tips"
          hitSlop={8}
          onPress={() => {
            setTipsHidden(true)
            void setAppPreferencesWith((current) => ({ ...current, tipsHidden: true }))
          }}
        >
          <Text className="text-[12px] font-semibold text-muted">Hide</Text>
        </Pressable>
      </View>
    </View>
  )
}
