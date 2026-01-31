import { View, StyleSheet } from "react-native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"

export default function AuthLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
          gestureEnabled: false,
        }}
      >
        <Stack.Screen name="connect" />
      </Stack>
      <StatusBar style="auto" />
    </>
  )
}

const styles = StyleSheet.create({})
