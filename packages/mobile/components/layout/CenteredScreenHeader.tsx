import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { BrandMark } from "@/components/layout/BrandMark"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

/**
 * Navigation-bar shaped screen header: one circular control per side with the
 * screen's name centred between them. Pass `brand` to show the NIKCLI wordmark
 * instead of the title — tab roots already name themselves in the tab bar.
 */
export function CenteredScreenHeader({
  title,
  brand = false,
  left,
  right,
}: {
  title: string
  brand?: boolean
  left?: ReactNode
  right?: ReactNode
}) {
  const { palette } = useAppTheme()

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        paddingVertical: 0,
        paddingHorizontal: 0,
      }}
    >
      <View style={{ width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" }}>{left}</View>
      {brand ? (
        <View
          accessibilityRole="header"
          accessibilityLabel={title}
          style={{ flex: 1, marginHorizontal: 8, alignItems: "center", justifyContent: "center" }}
        >
          <BrandMark height={20} />
        </View>
      ) : (
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ flex: 1, marginHorizontal: 8, textAlign: "center", color: palette.ink, ...typeStyle(20, { weight: "700" }) }}
        >
          {title}
        </Text>
      )}
      <View style={{ width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" }}>{right}</View>
    </View>
  )
}
