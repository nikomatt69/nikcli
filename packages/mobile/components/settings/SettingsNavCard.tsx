import { forwardRef, type ComponentProps } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { ChevronRight, type LucideIcon } from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"
import { usePressAnimation } from "@/lib/animation"

type SettingsNavCardProps = {
  eyebrow: string
  title: string
  description: string
  badges?: string[]
  shimmer?: boolean
  /** Optional leading icon rendered in a tinted tile to the left of the copy. */
  icon?: LucideIcon
} & ComponentProps<typeof Pressable>

export const SettingsNavCard = forwardRef<View, SettingsNavCardProps>(function SettingsNavCard(
  { eyebrow, title, description, badges = [], shimmer = false, icon: Icon, onPressIn, onPressOut, ...props },
  ref,
) {
  const { palette, isDark } = useAppTheme()
  const press = usePressAnimation()
  function handlePressIn(e: Parameters<NonNullable<ComponentProps<typeof Pressable>["onPressIn"]>>[0]) {
    press.onPressIn()
    onPressIn?.(e)
  }

  function handlePressOut(e: Parameters<NonNullable<ComponentProps<typeof Pressable>["onPressOut"]>>[0]) {
    press.onPressOut()
    onPressOut?.(e)
  }

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={description}
        {...props}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        className="px-3 py-3.5"
        style={({ pressed }) => ({
          borderRadius: 14,
          borderCurve: "continuous",
          opacity: pressed ? 0.9 : 1,
          backgroundColor: pressed ? (isDark ? "rgba(255,255,255,0.05)" : "rgba(20,20,19,0.04)") : "transparent",
        })}
      >
        <View className="flex-row items-center justify-between gap-3">
          {Icon ? (
            <View
              className="h-10 w-10 items-center justify-center rounded-full bg-panel"
              style={{ borderCurve: "continuous" }}
            >
              <Icon size={18} color={palette.ink} strokeWidth={2} />
            </View>
          ) : null}
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-[12px] font-medium text-muted">{eyebrow}</Text>
            <Text className="text-[15px] font-semibold text-ink">{title}</Text>
            <Text className="text-[13px] leading-[18px] text-soft" numberOfLines={2}>
              {description}
            </Text>
            {badges.length ? (
              <Text className="mt-1 text-[12px] text-muted" numberOfLines={1}>
                {badges.join(" · ")}
              </Text>
            ) : null}
          </View>
          <ChevronRight size={17} color={palette.muted} strokeWidth={2} />
        </View>
      </Pressable>
    </Animated.View>
  )
})
