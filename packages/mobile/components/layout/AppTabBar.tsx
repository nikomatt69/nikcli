import { useCallback, useEffect, useMemo, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { AdaptiveBlur } from "@/components/GlassView"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { APP_TABS } from "@/components/layout/navigation.config"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"

export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets()
  const { config, bootstrap } = useServer()
  const { palette, isDark } = useAppTheme()
  const indicatorAnims = useRef(new Map<string, Animated.Value>()).current
  const visibleRoutes = useMemo(
    () =>
      state.routes
        .map((route, index) => ({ route, index, tab: APP_TABS.find((item) => item.route === route.name) }))
        .filter(
          (item): item is { route: (typeof state.routes)[number]; index: number; tab: (typeof APP_TABS)[number] } =>
            Boolean(item.tab),
        ),
    [state.routes],
  )

  function getIndicatorAnim(key: string, initialFocused: boolean): Animated.Value {
    if (!indicatorAnims.has(key)) {
      indicatorAnims.set(key, new Animated.Value(initialFocused ? 1 : 0))
    }
    return indicatorAnims.get(key)!
  }

  useEffect(() => {
    const currentKeys = new Set(visibleRoutes.map(({ route }) => route.key))
    for (const key of indicatorAnims.keys()) {
      if (!currentKeys.has(key)) indicatorAnims.delete(key)
    }
    visibleRoutes.forEach(({ route, index }) => {
      const anim = indicatorAnims.get(route.key)
      if (!anim) return
      Animated.spring(anim, {
        toValue: state.index === index ? 1 : 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 300,
        mass: 0.8,
      }).start()
    })
  }, [indicatorAnims, state.index, visibleRoutes])

  const overallStatus = !config
    ? { label: "Host offline", color: palette.danger }
    : !bootstrap?.github?.connected
      ? { label: "GitHub attention", color: palette.warn }
      : config.executionTarget === "container"
        ? {
            label: bootstrap?.execution?.container?.available ? "Container ready" : "Container unavailable",
            color: bootstrap?.execution?.container?.available ? palette.accentLight : palette.danger,
          }
        : { label: "Local execution", color: palette.success }

  const badgeTone = useCallback(
    (route: string) => {
      if (route === "settings") {
        if (!config) return palette.danger
        if (!bootstrap?.github?.connected) return palette.warn
      }
      if (route === "repos" && config?.executionTarget === "container") {
        return bootstrap?.execution?.container?.available ? palette.accentLight : palette.danger
      }
      return undefined
    },
    [bootstrap, config, palette],
  )

  return (
    <View
      style={{
        backgroundColor: "transparent",
        paddingBottom: bottom > 0 ? bottom : 10,
        paddingTop: 5,
        paddingHorizontal: 12,
      }}
    >
      {/* Glass pill container */}
      <View style={styles.pillContainer}>
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 80 : 65}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
        />
        {/* Tint overlay for depth */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? "rgba(17,17,17,0.30)" : "rgba(255,255,255,0.28)" },
          ]}
          pointerEvents="none"
        />
        {/* Glass border */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: 26,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.78)",
            },
          ]}
          pointerEvents="none"
        />

        {/* Status bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
          }}
        >
          <Text
            style={{
              fontSize: 8.5,
              fontWeight: "700",
              letterSpacing: 0.4,
              color: palette.muted,
              textTransform: "uppercase",
            }}
          >
            Mobile ops
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: overallStatus.color }} />
            <Text style={{ fontSize: 8.5, fontWeight: "600", letterSpacing: 0.2, color: palette.ink }}>
              {overallStatus.label}
            </Text>
          </View>
        </View>

        {/* Tab buttons */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          {visibleRoutes.map(({ route, index, tab }) => {
            const { options } = descriptors[route.key]
            const focused = state.index === index
            const badge = badgeTone(route.name)

            const Icon = tab.icon
            const focusAnim = getIndicatorAnim(route.key, focused)
            const onPress = () => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name as string)
            }

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? tab.label}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.84 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                })}
                android_ripple={{
                  color: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(14, 165, 233, 0.12)",
                  borderless: true,
                }}
              >
                <View
                  style={{
                    width: "100%",
                    maxWidth: 82,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    borderRadius: 16,
                    borderWidth: focused ? 1 : 0,
                    borderColor: focused
                      ? isDark
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(255,255,255,0.88)"
                      : "transparent",
                    backgroundColor: focused
                      ? isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.52)"
                      : "transparent",
                    gap: 2,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 9,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: focused ? 1 : 0,
                      borderColor: focused
                        ? isDark
                          ? "rgba(255,255,255,0.14)"
                          : "rgba(255,255,255,0.90)"
                        : "transparent",
                      backgroundColor: focused
                        ? isDark
                          ? "rgba(255,255,255,0.10)"
                          : "rgba(14,165,233,0.12)"
                        : "transparent",
                      position: "relative",
                    }}
                  >
                    <Icon
                      size={17}
                      color={focused ? palette.accentLight : palette.muted}
                      strokeWidth={focused ? 2.2 : 1.9}
                    />
                    {badge ? (
                      <View
                        style={{
                          position: "absolute",
                          top: 3,
                          right: 3,
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          backgroundColor: badge,
                        }}
                      />
                    ) : null}
                  </View>
                  <Text
                    style={{
                      fontSize: 8.5,
                      fontWeight: focused ? "700" : "500",
                      letterSpacing: 0.3,
                      color: focused ? palette.accentLight : palette.muted,
                      textAlign: "center",
                    }}
                  >
                    {tab.label}
                  </Text>
                  <Animated.View
                    style={{
                      width: 18,
                      height: 3,
                      borderRadius: 999,
                      backgroundColor: palette.accent,
                      opacity: focusAnim.interpolate({ inputRange: [0, 1], outputRange: [0.33, 1] }),
                    }}
                  />
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pillContainer: {
    borderRadius: 26,
    overflow: "hidden",
  },
})
