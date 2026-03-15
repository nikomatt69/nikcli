import type { ReactNode } from "react"
import { Text, View } from "react-native"

export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  return (
    <View className="items-center rounded-[30px] border border-dashed border-border bg-surface px-6 py-8">
      <Text className="text-lg font-semibold text-ink">{props.title}</Text>
      <Text className="mt-2 text-center text-sm leading-6 text-soft">{props.description}</Text>
      {props.action ? <View className="mt-4 w-full">{props.action}</View> : null}
    </View>
  )
}
