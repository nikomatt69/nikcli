import { Text, View } from "react-native"

type StatusPillProps = {
  label: string
  value: string
  tone?: "neutral" | "good" | "warn"
}

export function StatusPill({ label, value, tone = "neutral" }: StatusPillProps) {
  const toneClass =
    tone === "good"
      ? "border-success/20 bg-success/10"
      : tone === "warn"
        ? "border-danger/25 bg-danger/10"
        : "border-border bg-background/60"

  return (
    <View className={`rounded-full border px-3 py-2 ${toneClass}`}>
      <Text className="text-[10px] font-semibold uppercase tracking-[1.7px] text-soft">{label}</Text>
      <Text className="mt-1 text-[11px] font-semibold text-ink">{value}</Text>
    </View>
  )
}
