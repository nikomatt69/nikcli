import { Text, View } from "react-native"

export function ConnectionStatus(props: { connected: boolean; label: string }) {
  return (
    <View className="flex-row items-center gap-3 rounded-full border border-border bg-panel/85 px-4 py-2.5">
      <View className={`h-2.5 w-2.5 rounded-full ${props.connected ? "bg-success" : "bg-danger"}`} />
      <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">{props.label}</Text>
    </View>
  )
}
