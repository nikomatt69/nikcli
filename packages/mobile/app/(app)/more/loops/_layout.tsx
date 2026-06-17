import { Stack } from "expo-router"
import { SettingsHeaderButton } from "@/components/layout/AppHeader"
import { useAppTheme } from "@/lib/theme"

export default function LoopsLayout() {
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
        options={{ title: "Loops", headerLargeTitle: true, headerRight: () => <SettingsHeaderButton /> }}
      />
      <Stack.Screen name="[loopId]" options={{ title: "Loop" }} />
    </Stack>
  )
}
