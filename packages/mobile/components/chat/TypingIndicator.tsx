import { useEffect, useRef } from "react"
import { Animated, Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"

interface TypingIndicatorProps {
  users?: Array<{ name: string; avatar?: string }>
  showNames?: boolean
}

export function TypingIndicator({ users = [], showNames = true }: TypingIndicatorProps) {
  const { isDark } = useAppTheme()
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current
  const dot3 = useRef(new Animated.Value(0)).current

  useEffect(() => {
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
  }, [dot1, dot2, dot3])

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
    <View className="mb-2 items-start pl-4">
      <View className="flex-row items-center gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: bubbleBg }}>
        <View className="flex-row items-center gap-1">
          {dots.map((anim, i) => (
            <Animated.View
              key={i}
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: dotColor,
                opacity: anim,
                transform: [
                  {
                    translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }),
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

export function OnlineStatus({ status, size = 10 }: { status: "online" | "offline" | "busy"; size?: number }) {
  const { isDark } = useAppTheme()

  const colors = {
    online: isDark ? "#30D158" : "#34C759",
    offline: isDark ? "#636366" : "#8E8E93",
    busy: isDark ? "#FF9F0A" : "#FF9500",
  }

  return (
    <View
      className="rounded-full border-2"
      style={{
        width: size,
        height: size,
        backgroundColor: colors[status],
        borderColor: isDark ? "#111111" : "#FFFFFF",
      }}
    />
  )
}

export function ChatAvatar({
  name,
  avatar,
  size = 36,
  status,
}: {
  name: string
  avatar?: string
  size?: number
  status?: "online" | "offline" | "busy"
}) {
  const { isDark } = useAppTheme()

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <View className="relative">
      <View
        className="items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: isDark ? "#2C2C2E" : "#E9E9EB",
        }}
      >
        <Text
          className="font-semibold"
          style={{
            fontSize: size * 0.4,
            color: isDark ? "#FFFFFF" : "#000000",
          }}
        >
          {initials}
        </Text>
      </View>

      {status && (
        <View
          className="absolute bottom-0 right-0 rounded-full border-2"
          style={{
            width: size * 0.35,
            height: size * 0.35,
            borderColor: isDark ? "#111111" : "#FFFFFF",
            backgroundColor:
              status === "online"
                ? isDark
                  ? "#30D158"
                  : "#34C759"
                : status === "busy"
                  ? isDark
                    ? "#FF9F0A"
                    : "#FF9500"
                  : isDark
                    ? "#636366"
                    : "#8E8E93",
          }}
        />
      )}
    </View>
  )
}
