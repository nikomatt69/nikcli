import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function UserLayout() {
  const { palette } = useAppTheme()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.ink,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Profile", headerLargeTitle: true }} />
    </Stack>
  )
}
