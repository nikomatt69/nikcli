import { forwardRef, useRef, type ComponentProps } from "react"
import { Animated, Pressable, Text, View } from "react-native"
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
  const { palette } = useAppTheme()
  const scaleRef = useRef<Animated.Value | null>(null)
  if (scaleRef.current === null) scaleRef.current = new Animated.Value(1)
  const scale = scaleRef.current
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
        className="border border-border bg-background/60 px-4 py-3.5"
        style={({ pressed }) => ({
          borderRadius: 16,
          borderCurve: "continuous",
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-[12px] font-semibold text-accent-light">{eyebrow}</Text>
            <Text className="text-base font-semibold text-ink">{title}</Text>
            <Text className="text-[13px] leading-[18px] text-soft" numberOfLines={2}>
              {description}
            </Text>
            {badges.length ? (
              <Text className="mt-1 text-[12px] text-muted" numberOfLines={1}>
                {badges.join(" · ")}
              </Text>
            ) : null}
          </View>
          <View className="h-8 w-8 items-center justify-center rounded-full bg-surface">
            <ChevronRight size={18} color={palette.muted} strokeWidth={2.1} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
})
