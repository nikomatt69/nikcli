import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"

export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  const { palette } = useAppTheme()

  return (
    <View
      className="items-center overflow-hidden px-6 py-10"
      style={{
        borderRadius: 20,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.ink, 0.08),
        backgroundColor: palette.surfaceRaised,
      }}
    >
      <Text className="text-center text-[19px] font-semibold tracking-[-0.3px] text-ink">{props.title}</Text>
      <Text className="mt-2 max-w-[280px] text-center text-sm leading-6 text-muted">{props.description}</Text>
      {props.action ? <View className="mt-5 w-full">{props.action}</View> : null}
    </View>
  )
}
