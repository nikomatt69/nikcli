import { forwardRef, type ComponentProps, type ReactNode } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { ChevronRight, type LucideIcon } from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { usePressAnimation } from "@/lib/animation"
import { type as typeStyle } from "@/lib/typography"

const GROUP_RADIUS = 28

export function SettingsGroup({ children }: { children: ReactNode }) {
  const { palette, isDark } = useAppTheme()
  return (
    <View
      style={{
        borderRadius: GROUP_RADIUS,
        borderCurve: "continuous",
        shadowColor: palette.shadow,
        shadowOpacity: isDark ? 0.28 : 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <View
        style={{
          overflow: "hidden",
          borderRadius: GROUP_RADIUS,
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark ? hexToRgba(palette.ink, 0.12) : hexToRgba(palette.surfaceRaised, 0.9),
          paddingVertical: 10,
        }}
      >
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 82 : 72}
          style={StyleSheet.absoluteFill}
          fallbackColor={hexToRgba(palette.surfaceRaised, isDark ? 0.72 : 0.78)}
          opaqueFallbackColor={palette.surface}
          pointerEvents="none"
        />
        {children}
      </View>
    </View>
  )
}

type SettingsNavCardProps = {
  eyebrow?: string
  title: string
  description: string
  badges?: string[]
  shimmer?: boolean
  /** Optional leading icon rendered in a tinted tile to the left of the copy. */
  icon?: LucideIcon
} & ComponentProps<typeof Pressable>

export const SettingsNavCard = forwardRef<View, SettingsNavCardProps>(function SettingsNavCard(
  { eyebrow, title, description, badges = [], shimmer: _shimmer = false, icon: Icon, onPressIn, onPressOut, ...props },
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
    <Animated.View style={{ alignSelf: "stretch", transform: [{ scale: press.scale }] }}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={description}
        {...props}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed }) => ({
          width: "100%",
          paddingLeft: 20,
          paddingRight: 16,
          paddingVertical: 16,
          minHeight: 88,
          opacity: pressed ? 0.9 : 1,
          backgroundColor: pressed ? hexToRgba(palette.ink, 0.04) : "transparent",
        })}
      >
        <View
          style={{
            width: "100%",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 14,
          }}
        >
          {Icon ? (
            <View
              style={{
                width: 40,
                height: 40,
                flexShrink: 0,
                marginTop: 2,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundColor: hexToRgba(palette.ink, 0.06),
                borderWidth: 1,
                borderColor: hexToRgba(palette.ink, 0.1),
              }}
            >
              <Icon size={18} color={palette.muted} strokeWidth={2.1} />
            </View>
          ) : null}
          <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, paddingRight: 4 }}>
            {eyebrow ? (
              <Text style={{ marginBottom: 4, color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>
                {eyebrow}
              </Text>
            ) : null}
            <Text numberOfLines={1} style={{ color: palette.ink, ...typeStyle(16, { weight: "600" }) }}>
              {title}
            </Text>
            <Text numberOfLines={2} style={{ marginTop: 6, color: palette.soft, ...typeStyle(14) }}>
              {description}
            </Text>
            {badges.length ? (
              <Text numberOfLines={1} style={{ marginTop: 8, color: palette.muted, ...typeStyle(12) }}>
                {badges.join(" · ")}
              </Text>
            ) : null}
          </View>
          <View style={{ width: 18, flexShrink: 0, alignSelf: "center", alignItems: "flex-end" }}>
            <ChevronRight size={16} color={palette.muted} strokeWidth={2} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
})
