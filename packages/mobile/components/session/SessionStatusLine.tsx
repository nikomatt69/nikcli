import { useEffect, useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { Sparkles } from "lucide-react-native"
import { usePrefersReducedMotion } from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

type SessionStatusLineProps = {
  /** Shown while the agent holds the turn ("Working", "Retrying in 3s"). */
  label?: string
  working: boolean
  runningCount: number
  onOpenActivity(): void
}

/**
 * The live footer of the transcript: what the session is doing right now, and
 * how much of it is happening off-screen. The count is the way into the
 * background-activity sheet.
 */
export function SessionStatusLine({ label, working, runningCount, onOpenActivity }: SessionStatusLineProps) {
  const { palette } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const spinRef = useRef<Animated.Value | null>(null)
  if (spinRef.current === null) spinRef.current = new Animated.Value(0)
  const spin = spinRef.current

  useEffect(() => {
    if (!working || prefersReducedMotion) {
      spin.setValue(0)
      return
    }
    const animation = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2600, useNativeDriver: true }),
    )
    animation.start()
    return () => animation.stop()
  }, [prefersReducedMotion, spin, working])

  if (!working && runningCount === 0) return null

  const countLabel = `${runningCount} ${runningCount === 1 ? "task" : "tasks"} running`

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 }}>
      <Animated.View
        style={{
          transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
        }}
      >
        <Sparkles size={16} color={palette.warn} strokeWidth={2.2} />
      </Animated.View>
      {working ? (
        <Text style={{ color: palette.warn, ...typeStyle(15, { weight: "500" }) }} numberOfLines={1}>
          {label ?? "Working"}…
        </Text>
      ) : null}
      {runningCount > 0 ? (
        <>
          {working ? <Text style={{ color: palette.muted, ...typeStyle(15) }}>·</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${countLabel}. Opens background activity.`}
            onPress={() => {
              void triggerHaptic("selection")
              onOpenActivity()
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ color: palette.accentLight, ...typeStyle(15, { weight: "500" }) }}>{countLabel}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  )
}
