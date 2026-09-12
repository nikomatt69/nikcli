import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function SettingsLayout() {
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
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="appearance" options={{ title: "Appearance" }} />
      <Stack.Screen name="security" options={{ title: "Security" }} />
      <Stack.Screen name="providers" options={{ title: "Models" }} />
      <Stack.Screen name="github" options={{ title: "GitHub" }} />
      <Stack.Screen name="permissions" options={{ title: "Permissions" }} />
      <Stack.Screen name="plugins" options={{ title: "Plugins" }} />
      <Stack.Screen name="mcp" options={{ title: "MCP" }} />
      <Stack.Screen name="commands" options={{ title: "Commands" }} />
      <Stack.Screen name="memories" options={{ title: "Memories" }} />
      <Stack.Screen name="skills" options={{ title: "Skills" }} />
      <Stack.Screen name="agents" options={{ title: "Agents" }} />
      <Stack.Screen name="tokens" options={{ title: "Access Tokens" }} />
      <Stack.Screen name="connectors" options={{ title: "Connectors" }} />
    </Stack>
  )
}
