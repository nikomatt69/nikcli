import { useEffect } from "react"
import { useFonts } from "expo-font"
import { SplashScreen } from "expo-router"
import { useThemeContext } from "./ThemeProvider"

export function FontProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useThemeContext()

  const [fontsLoaded, error] = useFonts({
    Inter: require("../../assets/fonts/Inter-Regular.otf"),
    "Inter-Medium": require("../../assets/fonts/Inter-Medium.otf"),
    "Inter-SemiBold": require("../../assets/fonts/Inter-SemiBold.otf"),
    "Inter-Bold": require("../../assets/fonts/Inter-Bold.otf"),
    ...Platform.select({
      ios: {
        SFPro: require("../../assets/fonts/SF-Pro-Regular.otf"),
      },
      android: {},
    }),
  })

  useEffect(() => {
    if (fontsLoaded || error) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, error])

  if (!fontsLoaded && !error) {
    return null
  }

  return <>{children}</>
}
