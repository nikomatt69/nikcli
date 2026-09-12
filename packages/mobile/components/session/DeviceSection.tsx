import { Animated, Pressable, Text, View } from "react-native"
import { router } from "expo-router"
import { Plus } from "lucide-react-native"
import { ListRow, StatusDot } from "@/components/ui/ListRow"
import { usePressAnimation } from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

export function formatHostLabel(url?: string): string {
  if (!url) return "No host connected"
  try {
    const parsed = new URL(url)
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  } catch {
    return url
  }
}

type DeviceSectionProps = {
  url?: string
  connected: boolean
  version?: string
}

/**
 * Hosts this app can drive. The current one is a quiet row; adding another is
 * a bordered pill. Layout lives on an inner View so NativeWind cannot collapse
 * Pressable into a column.
 */
export function DeviceSection({ url, connected, version }: DeviceSectionProps) {
  const { palette } = useAppTheme()
  const press = usePressAnimation()
  const detail = connected ? [version ? `v${version}` : null, "Connected"].filter(Boolean).join(" · ") : "Disconnected"

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: palette.muted, paddingHorizontal: 4, ...typeStyle(15, { weight: "500" }) }}>Devices</Text>

      {url ? (
        <ListRow
          leading={<StatusDot color={connected ? palette.success : hexToRgba(palette.ink, 0.25)} />}
          title={formatHostLabel(url)}
          subtitle={detail}
          accessibilityHint="Opens host settings"
          onPress={() => {
            void triggerHaptic("selection")
            router.push("/more/host")
          }}
        />
      ) : null}

      <Animated.View style={{ alignSelf: "flex-start", transform: [{ scale: press.scale }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add device"
          accessibilityHint="Connect this app to another nikcli host"
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onPress={() => {
            void triggerHaptic("selection")
            router.push({ pathname: "/connect", params: { intent: "add" } })
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: 999,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: hexToRgba(palette.ink, 0.16),
              backgroundColor: palette.background,
            }}
          >
            <Plus size={18} color={palette.ink} strokeWidth={2.2} />
            <Text style={{ color: palette.ink, ...typeStyle(16, { weight: "600" }) }}>Add device</Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  )
}
