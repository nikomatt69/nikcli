import { Pressable, Text, View } from "react-native"
import { useUIStore } from "@/lib/store"
import { setAppPreferencesWith } from "@/lib/storage"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"
import { nextTip } from "@/lib/tips"

export function TipsCard({ seed }: { seed?: number }) {
  const { palette } = useAppTheme()
  const hidden = useUIStore((state) => state.tipsHidden)
  const setTipsHidden = useUIStore((state) => state.setTipsHidden)
  if (hidden) return null
  const tip = nextTip(seed)

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.ink, 0.08),
        backgroundColor: palette.surfaceRaised,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>Tip</Text>
          <Text style={{ marginTop: 4, color: palette.ink, ...typeStyle(13) }}>{tip}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide tips"
          hitSlop={8}
          onPress={() => {
            setTipsHidden(true)
            void setAppPreferencesWith((current) => ({ ...current, tipsHidden: true }))
          }}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: "center",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "600" }) }}>Hide</Text>
        </Pressable>
      </View>
    </View>
  )
}
