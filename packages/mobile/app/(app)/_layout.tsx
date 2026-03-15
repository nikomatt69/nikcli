import { useEffect } from "react"
import { Tabs, useSegments } from "expo-router"
import { AppHeader } from "@/components/layout/AppHeader"
import { AppTabBar } from "@/components/layout/AppTabBar"
import { useUIStore } from "@/lib/store"

export default function AppLayout() {
  const segments = useSegments()
  const hideChrome = segments.length > 2
  const closeDrawer = useUIStore((state) => state.closeDrawer)

  useEffect(() => {
    if (hideChrome) closeDrawer()
  }, [closeDrawer, hideChrome])

  return (
    <Tabs
      tabBar={(props) => (hideChrome ? null : <AppTabBar {...props} />)}
      screenOptions={{
        headerShown: !hideChrome,
        header: ({ route }) => <AppHeader routeName={route.name} />,
        sceneStyle: { backgroundColor: "#06121f" },
      }}
    >
      <Tabs.Screen name="sessions" options={{ title: "Sessions" }} />
      <Tabs.Screen name="repos" options={{ title: "Repos" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  )
}
