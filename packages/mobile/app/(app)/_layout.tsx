import { Pressable, View, Text, Platform } from "react-native"
import { Tabs, type Href } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import Ionicons from "@expo/vector-icons/Ionicons"

type IoniconName = React.ComponentProps<typeof Ionicons>["name"]

const TABS: {
  route: string
  label: string
  icon: IoniconName
  iconActive: IoniconName
}[] = [
  { route: "sessions", label: "Sessions", icon: "terminal-outline", iconActive: "terminal" },
  { route: "repos", label: "Repos", icon: "git-branch-outline", iconActive: "git-branch" },
  { route: "settings", label: "Settings", icon: "settings-outline", iconActive: "settings" },
]

function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets()

  return (
    <View
      style={{
        backgroundColor: "#0a1829",
        borderTopWidth: 1,
        borderTopColor: "#162840",
        paddingBottom: bottom > 0 ? bottom : 16,
        paddingTop: 10,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "flex-start",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 20,
      }}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]
        const focused = state.index === index
        const tab = TABS.find((t) => t.route === route.name)
        if (!tab) return null

        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name as string)
          }
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            style={{ flex: 1, alignItems: "center" }}
            android_ripple={{ color: "#38bdf820", borderless: true }}
          >
            <View
              style={{
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: 20,
                backgroundColor: focused ? "#38bdf812" : "transparent",
                minWidth: 64,
                gap: 3,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: focused ? "#38bdf815" : "transparent",
                }}
              >
                <Ionicons
                  name={focused ? tab.iconActive : tab.icon}
                  size={22}
                  color={focused ? "#7dd3fc" : "#4a6a85"}
                />
              </View>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: focused ? "700" : "500",
                  letterSpacing: 0.4,
                  color: focused ? "#7dd3fc" : "#4a6a85",
                  marginTop: 1,
                }}
              >
                {tab.label}
              </Text>
            </View>
            {focused && (
              <View
                style={{
                  position: "absolute",
                  bottom: -10,
                  left: "50%",
                  marginLeft: -12,
                  width: 24,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: "#38bdf8",
                }}
              />
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

function Navbar(props: { routeName: string }) {
  const title = TABS.find((tab) => tab.route === props.routeName)?.label ?? "Nikcli"

  return (
    <View className="border-b border-border bg-background px-4 pb-4 pt-14">
      <View className="rounded-[28px] border border-border bg-surface px-4 py-4">
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Nikcli Mobile</Text>
        <View className="mt-2 flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-2xl font-semibold text-ink">{title}</Text>
          <View className="rounded-full bg-background/70 px-3 py-2">
            <Text className="text-[11px] font-semibold uppercase tracking-[1.6px] text-soft">Control</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

export default function AppLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: true,
        header: ({ route }) => <Navbar routeName={route.name} />,
        sceneStyle: { backgroundColor: "#06121f" },
      }}
    >
      <Tabs.Screen name="sessions" options={{ title: "Sessions" }} />
      <Tabs.Screen name="repos" options={{ title: "Repos" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  )
}
