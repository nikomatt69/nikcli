import { Pressable, Text, View } from "react-native"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { APP_TABS } from "@/components/layout/navigation.config"

export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets()

  return (
    <View
      style={{
        backgroundColor: "#071523",
        borderTopWidth: 1,
        borderTopColor: "#17314b",
        paddingBottom: bottom > 0 ? bottom : 10,
        paddingTop: 8,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "flex-start",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.26,
        shadowRadius: 18,
        elevation: 22,
      }}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]
        const focused = state.index === index
        const tab = APP_TABS.find((item) => item.route === route.name)
        if (!tab) return null

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
            style={{ flex: 1, alignItems: "center" }}
            android_ripple={{ color: "#48c7f520", borderless: true }}
          >
            <View
              style={{
                alignItems: "center",
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 18,
                backgroundColor: focused ? "#48c7f512" : "transparent",
                minWidth: 68,
                gap: 2,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: focused ? "#48c7f518" : "transparent",
                }}
              >
                <Icon size={19} color={focused ? "#8bdcff" : "#54708a"} strokeWidth={focused ? 2.2 : 1.9} />
              </View>
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: focused ? "700" : "500",
                  letterSpacing: 0.45,
                  color: focused ? "#8bdcff" : "#54708a",
                }}
              >
                {tab.label}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}
