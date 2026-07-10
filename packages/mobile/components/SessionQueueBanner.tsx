import { Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"

export function SessionQueueBanner(props: {
  queuedCount: number
  processing: boolean
  offlineQueuedCount?: number
}) {
  const { palette, isDark } = useAppTheme()
  const offlineCount = props.offlineQueuedCount ?? 0

  if (offlineCount <= 0 && !props.processing && props.queuedCount <= 0) return null

  const offline =
    offlineCount > 0
      ? {
          label:
            offlineCount === 1
              ? "1 message saved · will send when the server is reachable"
              : `${offlineCount} messages saved · will send when the server is reachable`,
          dot: palette.warn,
          text: palette.warn,
          backgroundColor: isDark ? "rgba(245,158,11,0.14)" : "rgba(245,158,11,0.12)",
          borderColor: isDark ? "rgba(251,191,36,0.18)" : "rgba(217,119,6,0.16)",
        }
      : null

  const session =
    !offline &&
    (props.processing || props.queuedCount > 0)
      ? {
          label:
            props.queuedCount > 0
              ? props.queuedCount === 1
                ? "1 message queued · runs after the current step"
                : `${props.queuedCount} messages queued · run in order after the current step`
              : "Agent working · you can send more messages to queue them",
          dot: palette.accentLight,
          text: palette.accentLight,
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(20,20,19,0.05)",
          borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,19,0.08)",
        }
      : null

  const active = offline ?? session
  if (!active) return null

  return (
    <View
      className="flex-row items-center gap-2 px-4 py-2.5"
      style={{
        backgroundColor: active.backgroundColor,
        borderBottomWidth: 1,
        borderBottomColor: active.borderColor,
      }}
      accessibilityLiveRegion="polite"
    >
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: active.dot }} />
      <Text className="flex-1 text-sm font-medium" style={{ color: active.text }}>
        {active.label}
      </Text>
    </View>
  )
}
