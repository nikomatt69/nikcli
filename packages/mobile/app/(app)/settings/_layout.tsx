import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function SettingsLayout() {
  const { palette } = useAppTheme()

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  )
}
