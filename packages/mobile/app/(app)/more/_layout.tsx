import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function MoreLayout() {
  const { palette } = useAppTheme()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.ink,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: palette.background },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" options={{ title: "More", headerShown: false }} />
      <Stack.Screen name="loops" options={{ headerShown: false }} />
      <Stack.Screen name="missions" options={{ headerShown: false }} />
      <Stack.Screen name="brain" options={{ title: "Brain" }} />
      <Stack.Screen name="chatbots" options={{ title: "Chatbots" }} />
      <Stack.Screen name="observability" options={{ title: "Observability" }} />
      <Stack.Screen name="host" options={{ title: "Host status" }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
    </Stack>
  )
}
