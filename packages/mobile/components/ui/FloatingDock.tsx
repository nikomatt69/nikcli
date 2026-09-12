import { useState } from "react"
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Plus, Search } from "lucide-react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { usePressAnimation } from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { contrastOn, hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

type FloatingDockProps = {
  actionLabel: string
  onAction(): void
  actionLoading?: boolean
  searchValue: string
  onSearchChange(value: string): void
  searchPlaceholder: string
  /** Extra bottom offset when the screen sits above a tab bar. */
  bottomInset?: number
}

/**
 * Search field and compose control share one dock row so the action cannot
 * collapse into a stacked column or hide under the tab bar accessory.
 */
export function FloatingDock({
  actionLabel,
  onAction,
  actionLoading,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  bottomInset = 0,
}: FloatingDockProps) {
  const { palette, colorScheme, isDark } = useAppTheme()
  const insets = useSafeAreaInsets()
  const press = usePressAnimation()
  const [focused, setFocused] = useState(false)

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        paddingBottom: Math.max(insets.bottom, 12) + bottomInset,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, focused ? 0.22 : 0.1),
            shadowColor: palette.shadow,
            shadowOpacity: isDark ? 0.32 : 0.1,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}
        >
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 80 : 70}
            style={StyleSheet.absoluteFill}
            fallbackColor={hexToRgba(palette.surfaceRaised, 0.92)}
            opaqueFallbackColor={palette.surfaceRaised}
            pointerEvents="none"
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, minHeight: 52 }}>
            <Search size={18} color={palette.muted} strokeWidth={2} />
            <TextInput
              value={searchValue}
              onChangeText={onSearchChange}
              placeholder={searchPlaceholder}
              placeholderTextColor={palette.muted}
              selectionColor={palette.ink}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              keyboardAppearance={colorScheme === "light" ? "light" : "dark"}
              accessibilityLabel={searchPlaceholder}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={{ flex: 1, color: palette.ink, paddingVertical: 14, ...typeStyle(16) }}
            />
          </View>
        </View>

        <Animated.View style={{ flexShrink: 0, transform: [{ scale: press.scale }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            accessibilityState={{ disabled: Boolean(actionLoading) }}
            disabled={actionLoading}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            onPress={() => {
              void triggerHaptic("selection")
              onAction()
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                minHeight: 52,
                paddingHorizontal: 16,
                borderRadius: 999,
                borderCurve: "continuous",
                backgroundColor: palette.accent,
                shadowColor: palette.shadow,
                shadowOpacity: isDark ? 0.4 : 0.18,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
                opacity: actionLoading ? 0.82 : 1,
              }}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color={contrastOn(palette.accent)} />
              ) : (
                <Plus size={18} color={contrastOn(palette.accent)} strokeWidth={2.4} />
              )}
              <Text style={{ color: contrastOn(palette.accent), ...typeStyle(16, { weight: "600" }) }}>{actionLabel}</Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  )
}
