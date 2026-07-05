import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { Settings } from "lucide-react-native"
import { router } from "expo-router"
import { BrandMark } from "@/components/layout/BrandMark"
import { IconCircleButton } from "@/components/ui/IconCircleButton"
import { useAppTheme } from "@/lib/theme"

/**
 * Custom screen header used by the tab pages: bare NIKCLI brand image
 * top-left (no native glass bubble), large title below, optional circular
 * controls top-right.
 */
export function ScreenBrandHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { palette } = useAppTheme()

  return (
    <View style={{ paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark />
        {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{right}</View> : null}
      </View>
      <Text
        style={{
          fontSize: 34,
          fontWeight: "700",
          letterSpacing: -0.5,
          color: palette.ink,
        }}
      >
        {title}
      </Text>
    </View>
  )
}

/** Circular settings gear for ScreenBrandHeader `right` slots. */
export function SettingsCircleButton() {
  const { palette } = useAppTheme()

  return (
    <IconCircleButton size={36} accessibilityLabel="Open settings" onPress={() => router.push("/more/settings")}>
      <Settings size={17} color={palette.ink} strokeWidth={2} />
    </IconCircleButton>
  )
}
