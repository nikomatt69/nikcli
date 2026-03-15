import { Text, View } from "react-native"
import { cn } from "@/lib/cn"

type InfoChipProps = {
  label: string
  tone?: "neutral" | "accent" | "good" | "warn"
}

export function InfoChip({ label, tone = "neutral" }: InfoChipProps) {
  const toneClass =
    tone === "accent"
      ? "border-accent/25 bg-accent/10"
      : tone === "good"
        ? "border-success/25 bg-success/10"
        : tone === "warn"
          ? "border-danger/25 bg-danger/10"
          : "border-border/70 bg-background/75"

  const textClass =
    tone === "accent"
      ? "text-accent-light"
      : tone === "good"
        ? "text-emerald-200"
        : tone === "warn"
          ? "text-rose-200"
          : "text-ink"

  return (
    <View className={cn("rounded-full border px-3 py-2", toneClass)}>
      <Text className={cn("text-[11px] font-semibold", textClass)}>{label}</Text>
    </View>
  )
}
