import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"

export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  const { palette, isDark } = useAppTheme()

  return (
    <View
      className="items-center overflow-hidden rounded-[8px] border border-dashed px-6 py-8"
      style={{
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.9)",
        backgroundColor: palette.surfaceRaised,
      }}
    >
      <Text className="text-center text-[20px] font-semibold tracking-[-0.3px] text-ink">{props.title}</Text>
      <Text className="mt-2 max-w-[280px] text-center text-sm leading-6 text-soft">{props.description}</Text>
      {props.action ? <View className="mt-4 w-full">{props.action}</View> : null}
    </View>
  )
}
