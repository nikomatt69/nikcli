import { useCallback, useEffect, useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { APP_TABS } from "@/components/layout/navigation.config"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"

export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets()
  const { config, bootstrap } = useServer()
  const { palette, isDark } = useAppTheme()
  const indicatorAnims = useRef(new Map<string, Animated.Value>()).current

  function getIndicatorAnim(key: string, initialFocused: boolean): Animated.Value {
    if (!indicatorAnims.has(key)) {
      indicatorAnims.set(key, new Animated.Value(initialFocused ? 1 : 0))
    }
    return indicatorAnims.get(key)!
  }

  useEffect(() => {
    // Clean up stale entries for routes that no longer exist
    const currentKeys = new Set(state.routes.map((r) => r.key))
    for (const key of indicatorAnims.keys()) {
      if (!currentKeys.has(key)) indicatorAnims.delete(key)
    }

    state.routes.forEach((route, index) => {
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
  }, [indicatorAnims, state.index, state.routes])

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
        backgroundColor: palette.tabBackground,
        paddingBottom: bottom > 0 ? bottom : 10,
        paddingTop: 5,
        paddingHorizontal: 12,
      }}
    >
      <View
        style={{
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.tabSurface,
          borderRadius: 26,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
            backgroundColor: palette.tabStatus,
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

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key]
            const focused = state.index === index
            const tab = APP_TABS.find((item) => item.route === route.name)
            if (!tab) return null
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
                accessibilityRole="button"
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
                  color: isDark ? "rgba(72, 199, 245, 0.12)" : "rgba(14, 165, 233, 0.12)",
                  borderless: true,
                }}
              >
                <View
                  style={{
                    width: 82,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    borderRadius: 16,
                    backgroundColor: focused
                      ? isDark
                        ? "rgba(72, 199, 245, 0.09)"
                        : "rgba(14, 165, 233, 0.1)"
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
                      backgroundColor: focused
                        ? isDark
                          ? "rgba(72, 199, 245, 0.1)"
                          : "rgba(14, 165, 233, 0.15)"
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
                      opacity: focusAnim,
                      transform: [{ scaleX: focusAnim.interpolate({ inputRange: [0, 1], outputRange: [0.33, 1] }) }],
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
