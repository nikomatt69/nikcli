import { forwardRef, type ComponentProps } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { ChevronRight, type LucideIcon } from "lucide-react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { usePressAnimation } from "@/lib/animation"
import { type as typeStyle } from "@/lib/typography"

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
  const { palette } = useAppTheme()
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
        style={({ pressed }) => ({
          paddingHorizontal: 12,
          paddingVertical: 14,
          minHeight: 44,
          borderRadius: 14,
          borderCurve: "continuous",
          opacity: pressed ? 0.9 : 1,
          backgroundColor: pressed ? hexToRgba(palette.ink, 0.04) : "transparent",
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {Icon ? (
            <View
              style={{
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 20,
                backgroundColor: hexToRgba(palette.accent, 0.14),
              }}
            >
              <Icon size={18} color={palette.accent} strokeWidth={2} />
            </View>
          ) : null}
          <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
            <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>{eyebrow}</Text>
            <Text style={{ color: palette.ink, ...typeStyle(15, { weight: "600" }) }}>{title}</Text>
            <Text numberOfLines={2} style={{ color: palette.soft, ...typeStyle(13) }}>
              {description}
            </Text>
            {badges.length ? (
              <Text numberOfLines={1} style={{ marginTop: 2, color: palette.muted, ...typeStyle(12) }}>
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
