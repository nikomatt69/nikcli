import { useState } from "react"
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
 *
 * Both controls take their style as an object rather than the `({ pressed })`
 * callback: under this project's NativeWind JSX runtime the callback form does
 * not reach the view, which silently drops the row layout.
 */
export function DeviceSection({ url, connected, version }: DeviceSectionProps) {
  const { palette } = useAppTheme()
  const press = usePressAnimation()
  const [hostPressed, setHostPressed] = useState(false)
  const [addPressed, setAddPressed] = useState(false)

  const detail = connected ? [version ? `v${version}` : null, "Connected"].filter(Boolean).join(" · ") : "Disconnected"

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: palette.muted, paddingHorizontal: 4, ...typeStyle(15, { weight: "500" }) }}>Devices</Text>

      {url ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Host ${hostLabel(url)}. ${detail}`}
          accessibilityHint="Opens host settings"
          // Both the class and the style say "row": the class is the path this
          // app's working rows take, the style keeps it correct if class
          // resolution is ever unavailable to this component.
          className="flex-row items-center"
          onPressIn={() => setHostPressed(true)}
          onPressOut={() => setHostPressed(false)}
          onPress={() => {
            void triggerHaptic("selection")
            router.push("/more/host")
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 10,
            paddingHorizontal: 10,
            marginHorizontal: -6,
            borderRadius: 14,
            borderCurve: "continuous",
            backgroundColor: hostPressed ? hexToRgba(palette.ink, 0.05) : "transparent",
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hexToRgba(palette.ink, 0.05),
              borderWidth: 1,
              borderColor: hexToRgba(palette.ink, 0.08),
            }}
          >
            <Server size={17} color={palette.ink} strokeWidth={2} />
          </View>
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
          className="flex-row items-center"
          onPressIn={() => {
            setAddPressed(true)
            press.onPressIn()
          }}
          onPressOut={() => {
            setAddPressed(false)
            press.onPressOut()
          }}
          onPress={() => {
            void triggerHaptic("selection")
            router.push("/connect")
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 44,
            paddingHorizontal: 18,
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, 0.12),
            backgroundColor: addPressed ? hexToRgba(palette.ink, 0.06) : palette.surfaceRaised,
          }}
        >
          <Plus size={17} color={palette.ink} strokeWidth={2.2} />
          <Text style={{ color: palette.ink, ...typeStyle(15, { weight: "600" }) }}>Add device</Text>
        </Pressable>
      </Animated.View>
    </View>
  )
}
