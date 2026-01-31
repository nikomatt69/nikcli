import { useEffect } from "react"
import { Platform } from "react-native"
import { useFonts } from "expo-font"
import { SplashScreen } from "expo-router"
import { useThemeContext } from "./ThemeProvider"

export function FontProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useThemeContext()

  const [fontsLoaded, error] = useFonts(
    Platform.OS === "ios"
      ? {
          Inter: require("../../assets/fonts/Inter-Regular.otf"),
          "Inter-Medium": require("../../assets/fonts/Inter-Medium.otf"),
          "Inter-SemiBold": require("../../assets/fonts/Inter-SemiBold.otf"),
          "Inter-Bold": require("../../assets/fonts/Inter-Bold.otf"),
          SFPro: require("../../assets/fonts/SF-Pro-Regular.otf"),
        }
      : {
          Inter: require("../../assets/fonts/Inter-Regular.otf"),
          "Inter-Medium": require("../../assets/fonts/Inter-Medium.otf"),
          "Inter-SemiBold": require("../../assets/fonts/Inter-SemiBold.otf"),
          "Inter-Bold": require("../../assets/fonts/Inter-Bold.otf"),
        },
  )

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
