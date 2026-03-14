import { Link } from "expo-router"
import { Text, View } from "react-native"

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full rounded-[32px] border border-border bg-surface px-6 py-8">
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Navigation</Text>
        <Text className="mt-3 text-3xl font-semibold text-ink">Screen not found</Text>
        <Text className="mt-3 text-sm leading-6 text-soft">
          This route is unavailable in the current mobile workspace. Return to the connection screen to continue.
        </Text>
        <Link href="/" className="mt-5 text-sm font-semibold text-accent-light">
          Back to connect
        </Link>
      </View>
    </View>
  )
}
