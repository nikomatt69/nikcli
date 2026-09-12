import { router } from "expo-router"
import { ScrollView, View } from "react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { useAppTheme } from "@/lib/theme"

export default function NotFoundScreen() {
  const { palette } = useAppTheme()

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
    >
      <View style={{ width: "100%", maxWidth: 480, alignSelf: "center" }}>
        <EmptyState
          title="Screen not found"
          description="This screen is no longer available. Go back to continue where you left off."
          action={
            <ActionButton
              label={router.canGoBack() ? "Go back" : "Back to connect"}
              onPress={() => {
                if (router.canGoBack()) router.back()
                else router.replace("/")
              }}
            />
          }
        />
      </View>
    </ScrollView>
  )
}
