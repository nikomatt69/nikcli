import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function SessionsLayout() {
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
      <Stack.Screen
        name="index"
        options={{
          title: "Sessions",
          headerShown: false,
        }}
      />
      <Stack.Screen name="[sessionId]" options={{ headerShown: false }} />
      <Stack.Screen name="editor" options={{ headerShown: false }} />
      <Stack.Screen name="explorer" options={{ headerShown: false }} />
    </Stack>
  )
}
