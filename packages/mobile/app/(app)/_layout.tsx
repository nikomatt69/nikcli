import { useEffect } from "react"
import { View } from "react-native"
import { Tabs, useSegments } from "expo-router"
import { AppHeader } from "@/components/layout/AppHeader"
import { AppTabBar } from "@/components/layout/AppTabBar"
import { NetworkBanner } from "@/components/NetworkBanner"
import { useUIStore } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"

export default function AppLayout() {
  const segments = useSegments()
  const routeSegments = segments.filter((segment) => !segment.startsWith("("))
  const [root, child] = routeSegments
  const hideChrome = (root === "sessions" && Boolean(child)) || (root === "settings" && Boolean(child))
  const closeDrawer = useUIStore((state) => state.closeDrawer)
  const { palette } = useAppTheme()

  useEffect(() => {
    if (hideChrome) closeDrawer()
  }, [closeDrawer, hideChrome])

  return (
    <View style={{ flex: 1 }}>
      <NetworkBanner />
      <Tabs
        tabBar={(props) => (hideChrome ? null : <AppTabBar {...props} />)}
        screenOptions={{
          headerShown: !hideChrome,
          header: ({ route }) => <AppHeader routeName={route.name} />,
          sceneStyle: { backgroundColor: palette.background },
        }}
      >
        <Tabs.Screen name="sessions" options={{ title: "Sessions" }} />
        <Tabs.Screen name="repos" options={{ title: "Repos" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", href: null }} />
        <Tabs.Screen name="routines" options={{ title: "Routines" }} />
        <Tabs.Screen name="loops" options={{ title: "Loops" }} />
        <Tabs.Screen name="terminal" options={{ title: "Terminal" }} />
        <Tabs.Screen name="user" options={{ title: "Profile", href: null }} />
      </Tabs>
    </View>
  )
}
