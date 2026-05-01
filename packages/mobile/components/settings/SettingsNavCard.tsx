import { forwardRef, useEffect, useRef, type ComponentProps } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { ChevronRight } from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"
import { PRESS_SPRING } from "@/lib/animation"

type SettingsNavCardProps = {
  eyebrow: string
  title: string
  description: string
  badges?: string[]
  shimmer?: boolean
} & ComponentProps<typeof Pressable>

export const SettingsNavCard = forwardRef<View, SettingsNavCardProps>(function SettingsNavCard(
  { eyebrow, title, description, badges = [], shimmer = false, onPressIn, onPressOut, ...props },
  ref,
) {
  const { palette, isDark } = useAppTheme()
  const scale = useRef(new Animated.Value(1)).current
  const shimmerAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (shimmer) {
      const animation = Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      )
      animation.start()
      return () => animation.stop()
    }
  }, [shimmer, shimmerAnim])

  const shimmerOpacity = shimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0.3, 0],
  })

  function handlePressIn(e: Parameters<NonNullable<ComponentProps<typeof Pressable>["onPressIn"]>>[0]) {
    Animated.spring(scale, { toValue: 0.98, ...PRESS_SPRING }).start()
    onPressIn?.(e)
  }

  function handlePressOut(e: Parameters<NonNullable<ComponentProps<typeof Pressable>["onPressOut"]>>[0]) {
    Animated.spring(scale, { toValue: 1, ...PRESS_SPRING }).start()
    onPressOut?.(e)
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        ref={ref}
        {...props}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        className="rounded-[8px] border border-border bg-background/60 px-4 py-4"
        style={({ pressed }) => ({
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1.5">
            <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">{eyebrow}</Text>
            <Text className="text-base font-semibold text-ink">{title}</Text>
            <Text className="text-sm leading-5 text-soft">{description}</Text>
          </View>
          <View className="items-center justify-center">
            {shimmer ? (
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: isDark ? "rgba(14,165,233,0.15)" : "rgba(14,165,233,0.12)",
                    borderRadius: 8,
                    opacity: shimmerOpacity,
                  },
                ]}
              />
            ) : null}
            <ChevronRight size={18} color={palette.muted} strokeWidth={2.1} />
          </View>
        </View>

        {badges.length ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {badges.map((badge, index) => (
              <AnimatedBadge key={badge} badge={badge} index={index} shimmer={shimmer} />
            ))}
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  )
})

function AnimatedBadge({ badge, index, shimmer }: { badge: string; index: number; shimmer: boolean }) {
  const badgeAnim = useRef(new Animated.Value(shimmer ? 0 : 1)).current

  useEffect(() => {
    if (shimmer) {
      Animated.spring(badgeAnim, {
        toValue: 1,
        damping: 18,
        stiffness: 200,
        mass: 0.7,
        delay: index * 80,
        useNativeDriver: true,
      }).start()
    }
  }, [badgeAnim, shimmer, index])

  const glowOpacity = badgeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, shimmer ? 0.6 : 0],
  })

  return (
    <Animated.View
      className="rounded-full border border-border bg-surface px-3 py-1.5"
      style={{
        shadowColor: "#0ea5e9",
        shadowOpacity: glowOpacity,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <Text className="text-[10px] font-semibold uppercase tracking-[1.2px] text-soft">{badge}</Text>
    </Animated.View>
  )
}
