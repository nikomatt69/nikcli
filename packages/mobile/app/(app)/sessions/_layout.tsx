import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function SessionsLayout() {
  const { palette } = useAppTheme()

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
        animation: "slide_from_right",
      }}
    />
  )
}
