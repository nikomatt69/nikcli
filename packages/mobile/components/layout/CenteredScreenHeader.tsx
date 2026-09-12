import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

/**
 * Navigation-bar shaped screen header: one circular control per side with the
 * screen's name centred between them. The sides reserve equal width so the
 * title stays centred whether or not both controls are present.
 */
export function CenteredScreenHeader({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  const { palette } = useAppTheme()

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        paddingVertical: 8,
        paddingHorizontal: 4,
      }}
    >
      <View style={{ width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" }}>{left}</View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{ flex: 1, marginHorizontal: 8, textAlign: "center", color: palette.ink, ...typeStyle(20, { weight: "700" }) }}
      >
        {title}
      </Text>
      <View style={{ width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" }}>{right}</View>
    </View>
  )
}
