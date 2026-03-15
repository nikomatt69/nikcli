import { AlertTriangle } from "lucide-react-native"
import { Text, View } from "react-native"

export function ErrorBanner(props: { message: string }) {
  return (
    <View className="flex-row items-start gap-3 rounded-[24px] border border-danger/35 bg-danger/10 px-4 py-4">
      <View className="mt-0.5 rounded-full border border-danger/25 bg-danger/15 p-2">
        <AlertTriangle size={14} color="#fda4af" strokeWidth={2.1} />
      </View>
      <Text className="flex-1 text-sm leading-6 text-rose-200">{props.message}</Text>
    </View>
  )
}
