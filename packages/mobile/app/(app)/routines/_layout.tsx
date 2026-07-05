import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function RoutinesLayout() {
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
        options={{ title: "Routines", headerShown: false }}
      />
      <Stack.Screen name="[routineId]" options={{ title: "Routine" }} />
    </Stack>
  )
}
