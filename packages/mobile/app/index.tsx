import { useEffect, useState } from "react"
import { View, StyleSheet, ActivityIndicator } from "react-native"
import { useTheme } from "react-native-paper"
import { Redirect, Slot } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { ThemeProvider, QueryProvider } from "../src/providers"
import { getStoredCredentials } from "../src/services/crypto"

export default function RootLayout() {
  const theme = useTheme()
  const [isLoading, setIsLoading] = useState(true)
  const [needsAuth, setNeedsAuth] = useState(false)

  useEffect(() => {
    const init = async () => {
      const credentials = getStoredCredentials()
      const hasLocal = Boolean(credentials.url && credentials.secret)
      const hasCloud = Boolean(credentials.cloudUrl && credentials.cloudToken)

      if (!hasLocal && !hasCloud) {
        setNeedsAuth(true)
      }
      setIsLoading(false)
    }
    init()
  }, [])

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    )
  }

  return (
    <ThemeProvider>
      <QueryProvider>
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
          <StatusBar style={theme.dark ? "light" : "dark"} />
          {needsAuth ? <Redirect href="/connect" /> : <Slot />}
        </View>
      </QueryProvider>
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
})
