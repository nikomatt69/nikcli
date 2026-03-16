import React from "react"
import { View } from "react-native"
import { router } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"

type State = { hasError: boolean; message: string }

export class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: "" }

  static getDerivedStateFromError(error: Error): State {
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
          <ActionButton
            label="Restart"
            onPress={() => {
              this.setState({ hasError: false, message: "" })
              router.replace("/")
            }}
          />
        </View>
      )
    }
    return this.props.children
  }
}
