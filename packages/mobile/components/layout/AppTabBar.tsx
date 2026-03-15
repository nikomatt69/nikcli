import { Pressable, Text, View } from "react-native"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { APP_TABS } from "@/components/layout/navigation.config"
import { useServer } from "@/lib/server-provider"

export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets()
  const { config, bootstrap } = useServer()

  const overallStatus = !config
    ? { label: "Host offline", color: "#fb7185" }
    : !bootstrap?.github?.connected
      ? { label: "GitHub attention", color: "#f59e0b" }
      : config.executionTarget === "container"
        ? {
            label: bootstrap?.execution?.container?.available ? "Container ready" : "Container unavailable",
            color: bootstrap?.execution?.container?.available ? "#7dd3fc" : "#fb7185",
          }
        : { label: "Local execution", color: "#34d399" }

  function badgeTone(route: string) {
    if (route === "settings") {
      if (!config) return "#fb7185"
      if (!bootstrap?.github?.connected) return "#f59e0b"
    }
    if (route === "repos" && config?.executionTarget === "container") {
      return bootstrap?.execution?.container?.available ? "#7dd3fc" : "#fb7185"
    }
    return undefined
  }

  return (
    <View
      style={{
        backgroundColor: "#06121f",
        paddingBottom: bottom > 0 ? bottom : 10,
        paddingTop: 5,
        paddingHorizontal: 12,
      }}
    >
      <View
        style={{
          borderWidth: 1,
          borderColor: "#17314b",
          backgroundColor: "#071523",
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
            borderBottomColor: "#17314b",
            backgroundColor: "#081728",
          }}
        >
          <Text
            style={{
              fontSize: 8.5,
              fontWeight: "700",
              letterSpacing: 0.4,
              color: "#8ca5bc",
              textTransform: "uppercase",
            }}
          >
            Mobile ops
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: overallStatus.color }} />
            <Text style={{ fontSize: 8.5, fontWeight: "600", letterSpacing: 0.2, color: "#d9e6f2" }}>
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
                accessibilityLabel={options.tabBarAccessibilityLabel}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.84 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                })}
                android_ripple={{ color: "#48c7f520", borderless: true }}
              >
                <View
                  style={{
                    width: 82,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    borderRadius: 16,
                    backgroundColor: focused ? "#48c7f516" : "transparent",
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
                      backgroundColor: focused ? "#48c7f51a" : "transparent",
                      position: "relative",
                    }}
                  >
                    <Icon size={17} color={focused ? "#8bdcff" : "#54708a"} strokeWidth={focused ? 2.2 : 1.9} />
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
                      color: focused ? "#8bdcff" : "#54708a",
                      textAlign: "center",
                    }}
                  >
                    {tab.label}
                  </Text>
                  <View
                    style={{
                      width: focused ? 18 : 6,
                      height: 3,
                      borderRadius: 999,
                      backgroundColor: focused ? "#7dd3fc" : "transparent",
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
