import { Text, View } from "react-native"

type StatusPillProps = {
  label: string
  value: string
  tone?: "neutral" | "good" | "warn"
  compact?: boolean
}

export function StatusPill({ label, value, tone = "neutral", compact = false }: StatusPillProps) {
  const toneClass =
    tone === "good"
      ? "border-success/20 bg-success/10"
      : tone === "warn"
        ? "border-danger/25 bg-danger/10"
        : "border-border bg-background/60"

  return (
    <View className={`rounded-[16px] border ${compact ? "px-2 py-1.5" : "px-3 py-2.5"} ${toneClass}`}>
      <Text
        selectable
        className={`font-semibold uppercase tracking-[1.3px] text-soft ${compact ? "text-[8px]" : "text-[10px]"}`}
      >
        {label}
      </Text>
      <Text selectable className={`mt-0.5 font-semibold text-ink ${compact ? "text-[10px]" : "text-[12px]"}`}>
        {value}
      </Text>
    </View>
  )
}
