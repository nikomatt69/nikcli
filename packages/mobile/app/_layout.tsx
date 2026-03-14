import "@/global.css"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { ServerProvider } from "@/lib/server-provider"

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ServerProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#06121f" },
            headerTintColor: "#e6eef8",
            headerShadowVisible: false,
            contentStyle: { backgroundColor: "#06121f" },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="+not-found" options={{ title: "Not found" }} />
        </Stack>
      </ServerProvider>
    </SafeAreaProvider>
  )
}
