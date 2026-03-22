import React from "react"
import { Text, View } from "react-native"
import { router } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"

const MAX_RESTARTS = 3

type State = { hasError: boolean; message: string; restartCount: number }

export class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: "", restartCount: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error.message || "An unexpected error occurred." }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <View className="flex-1 items-center justify-center bg-background px-6 gap-4">
          <ErrorBanner message={this.state.message} />
          {this.state.restartCount < MAX_RESTARTS ? (
            <ActionButton
              label="Restart"
              onPress={() => {
                this.setState((prev) => ({ hasError: false, message: "", restartCount: prev.restartCount + 1 }))
                router.replace("/")
              }}
            />
          ) : (
            <Text className="text-center text-sm text-soft">
              The app encountered a persistent error. Please close and reopen the app.
            </Text>
          )}
        </View>
      )
    }
    return this.props.children
  }
}
