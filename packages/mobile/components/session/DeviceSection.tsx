import { Animated, Pressable, Text, View } from "react-native"
import { router } from "expo-router"
import { Plus, Server } from "lucide-react-native"
import { usePressAnimation } from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

function hostLabel(url?: string): string {
  if (!url) return "No host connected"
  try {
    const parsed = new URL(url)
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  } catch {
    return url
  }
}

type DeviceSectionProps = {
  /** The host this app is pointed at, if any. */
  url?: string
  connected: boolean
  version?: string
}

/**
 * The hosts this app can drive. nikcli talks to one at a time, so the section
 * shows the current one and the way to point somewhere else — the same shape as
 * the session list below it.
 */
export function DeviceSection({ url, connected, version }: DeviceSectionProps) {
  const { palette } = useAppTheme()
  const press = usePressAnimation()

  const detail = connected ? [version ? `v${version}` : null, "Connected"].filter(Boolean).join(" · ") : "Disconnected"

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: palette.muted, paddingHorizontal: 4, ...typeStyle(15, { weight: "500" }) }}>Devices</Text>

      {url ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Host ${hostLabel(url)}. ${detail}`}
          accessibilityHint="Opens host settings"
          onPress={() => {
            void triggerHaptic("selection")
            router.push("/more/host")
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 4,
            borderRadius: 12,
            borderCurve: "continuous",
            backgroundColor: pressed ? hexToRgba(palette.ink, 0.04) : "transparent",
          })}
        >
          <Server size={18} color={palette.ink} strokeWidth={2} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: palette.ink, ...typeStyle(15, { weight: "600" }) }}>
              {hostLabel(url)}
            </Text>
            <Text numberOfLines={1} style={{ color: palette.muted, ...typeStyle(13) }}>
              {detail}
            </Text>
          </View>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              backgroundColor: connected ? palette.success : hexToRgba(palette.ink, 0.25),
            }}
          />
        </Pressable>
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
            router.push("/connect")
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 48,
            paddingHorizontal: 20,
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, 0.12),
            backgroundColor: pressed ? hexToRgba(palette.ink, 0.05) : palette.surfaceRaised,
          })}
        >
          <Plus size={18} color={palette.ink} strokeWidth={2.2} />
          <Text style={{ color: palette.ink, ...typeStyle(16, { weight: "600" }) }}>Add device</Text>
        </Pressable>
      </Animated.View>
    </View>
  )
}
