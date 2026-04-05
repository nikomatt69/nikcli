import "react-native-gesture-handler"
import "@/global.css"
import { useEffect } from "react"
import { Stack, router, usePathname } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useColorScheme } from "nativewind"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary"
import { ServerProvider, useServer } from "@/lib/server-provider"
import { setupOfflineDrainOnForeground } from "@/lib/offline"
import { getAppPreferences } from "@/lib/storage"
import { useUIStore } from "@/lib/store"
import { palettes } from "@/lib/theme"

function AuthGuard() {
  const { config, ready, userToken, userLoading } = useServer()
  const pathname = usePathname()

  useEffect(() => {
    if (!ready || userLoading) return
    if (!config) return // no server — index.tsx (connect screen) handles this
    // Don't redirect if already on login or connect screen
    if (pathname === "/login" || pathname === "/" || pathname === "") return
    if (!userToken) {
      router.replace("/login")
    }
  }, [ready, userLoading, config, userToken, pathname])

  return null
}

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme()
  const hydratePreferences = useUIStore((state) => state.hydratePreferences)
  const themeMode = useUIStore((state) => state.themeMode)

  useEffect(() => {
    getAppPreferences()
      .then(hydratePreferences)
      .catch(() => undefined)
    return setupOfflineDrainOnForeground()
  }, [hydratePreferences])

  useEffect(() => {
    setColorScheme(themeMode)
  }, [setColorScheme, themeMode])

  const palette = colorScheme === "light" ? palettes.light : palettes.dark

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <GlobalErrorBoundary>
          <ServerProvider>
            <AuthGuard />
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
              <Stack.Screen name="login" options={{ headerShown: false, presentation: "fullScreenModal" }} />
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
              <Stack.Screen name="+not-found" options={{ title: "Not found" }} />
            </Stack>
          </ServerProvider>
        </GlobalErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
