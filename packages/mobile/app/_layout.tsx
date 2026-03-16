import "react-native-gesture-handler"
import "@/global.css"
import { useEffect } from "react"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useColorScheme } from "nativewind"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { ensureNotificationPermissions } from "@/lib/notifications"
import { ServerProvider } from "@/lib/server-provider"
import { getAppPreferences } from "@/lib/storage"
import { useUIStore } from "@/lib/store"
import { palettes } from "@/lib/theme"

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme()
  const hydratePreferences = useUIStore((state) => state.hydratePreferences)
  const themeMode = useUIStore((state) => state.themeMode)
  const notificationsEnabled = useUIStore((state) => state.notifications.enabled)
  const preferencesReady = useUIStore((state) => state.preferencesReady)

  useEffect(() => {
    getAppPreferences()
      .then(hydratePreferences)
      .catch(() => undefined)
  }, [hydratePreferences])

  useEffect(() => {
    setColorScheme(themeMode)
  }, [setColorScheme, themeMode])

  useEffect(() => {
    if (!preferencesReady || !notificationsEnabled) return
    void ensureNotificationPermissions(true)
  }, [notificationsEnabled, preferencesReady])

  const palette = colorScheme === "light" ? palettes.light : palettes.dark

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ServerProvider>
          <StatusBar style={colorScheme === "light" ? "dark" : "light"} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: palette.background },
              headerTintColor: palette.ink,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: palette.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
            <Stack.Screen name="+not-found" options={{ title: "Not found" }} />
          </Stack>
        </ServerProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
