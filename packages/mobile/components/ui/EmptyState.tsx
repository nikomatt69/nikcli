import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  const { palette } = useAppTheme()

  return (
    <View
      style={{
        alignItems: "center",
        overflow: "hidden",
        paddingHorizontal: 24,
        paddingVertical: 36,
        borderRadius: 20,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.ink, 0.08),
        backgroundColor: palette.surfaceRaised,
      }}
    >
      <Text selectable style={{ textAlign: "center", color: palette.ink, ...typeStyle(19, { weight: "600" }) }}>
        {props.title}
      </Text>
      <Text
        selectable
        style={{
          marginTop: 8,
          maxWidth: 280,
          textAlign: "center",
          color: palette.muted,
          ...typeStyle(15),
        }}
      >
        {props.description}
      </Text>
      {props.action ? <View style={{ marginTop: 20, width: "100%" }}>{props.action}</View> : null}
    </View>
  )
}
