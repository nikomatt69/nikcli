import { useEffect, useRef } from "react"
import { Animated, Text, View } from "react-native"
import { usePrefersReducedMotion } from "@/lib/animation"
import { useAppTheme } from "@/lib/theme"

interface TypingIndicatorProps {
  users?: Array<{ name: string; avatar?: string }>
  showNames?: boolean
}

const EMPTY_USERS: NonNullable<TypingIndicatorProps["users"]> = []

export function TypingIndicator({ users = EMPTY_USERS, showNames = true }: TypingIndicatorProps) {
  const { isDark } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const dot1Ref = useRef<Animated.Value | null>(null)
  if (dot1Ref.current === null) dot1Ref.current = new Animated.Value(0)
  const dot1 = dot1Ref.current
  const dot2Ref = useRef<Animated.Value | null>(null)
  if (dot2Ref.current === null) dot2Ref.current = new Animated.Value(0)
  const dot2 = dot2Ref.current
  const dot3Ref = useRef<Animated.Value | null>(null)
  if (dot3Ref.current === null) dot3Ref.current = new Animated.Value(0)
  const dot3 = dot3Ref.current

  useEffect(() => {
    if (prefersReducedMotion) {
      dot1.setValue(0.62)
      dot2.setValue(0.62)
      dot3.setValue(0.62)
      return undefined
    }

    const makeDotAnim = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.delay(Math.max(0, 660 - delay - 440)),
        ]),
      )

    const anim = Animated.parallel([makeDotAnim(dot1, 0), makeDotAnim(dot2, 160), makeDotAnim(dot3, 320)])
    anim.start()
    return () => anim.stop()
  }, [dot1, dot2, dot3, prefersReducedMotion])

  const bubbleBg = isDark ? "#2C2C2E" : "#E9E9EB"
  const dotColor = isDark ? "#8E8E93" : "#8E8E93"
  const textColor = isDark ? "#FFFFFF" : "#000000"

  const names = users.map((u) => u.name).join(", ")
  const text =
    users.length === 1
      ? `${users[0].name} is typing`
      : users.length === 2
        ? `${users[0].name} and ${users[1].name} are typing`
        : users.length > 2
          ? `${users[0].name} and ${users.length - 1} others are typing`
          : "typing..."

  const dots = [dot1, dot2, dot3]

  return (
    <View
      className="mb-2 items-start pl-4"
      accessible
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
    >
      <View className="flex-row items-center gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: bubbleBg }}>
        <View className="flex-row items-center gap-1">
          {dots.map((anim, i) => (
            <Animated.View
              key={i}
              className="size-2 rounded-full"
              style={{
                backgroundColor: dotColor,
                opacity: anim,
                transform: [
                  {
                    translateY: prefersReducedMotion
                      ? 0
                      : anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }),
                  },
                ],
              }}
            />
          ))}
        </View>

        {showNames && names && (
          <Text className="text-[13px]" style={{ color: textColor, opacity: 0.7 }}>
            {text}
          </Text>
        )}
      </View>
    </View>
  )
}
