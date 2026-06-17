import { Stack } from "expo-router"
import { SettingsHeaderButton } from "@/components/layout/AppHeader"
import { useAppTheme } from "@/lib/theme"

export default function TerminalLayout() {
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
          title: "Terminal",
          // The terminal is a full-bleed, non-scrolling tool screen. A large title
          // header is translucent and expects scroll content underneath it, which
          // made the terminal render *behind* the header. A standard header reserves
          // its own height so the terminal starts directly below it.
          headerLargeTitle: false,
          headerRight: () => <SettingsHeaderButton />,
        }}
      />
    </Stack>
  )
}
