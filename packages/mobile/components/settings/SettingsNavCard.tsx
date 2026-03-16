import { forwardRef, type ComponentProps } from "react"
import { Pressable, Text, View } from "react-native"
import { ChevronRight } from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"

type SettingsNavCardProps = {
  eyebrow: string
  title: string
  description: string
  badges?: string[]
} & ComponentProps<typeof Pressable>

export const SettingsNavCard = forwardRef<View, SettingsNavCardProps>(function SettingsNavCard(
  { eyebrow, title, description, badges = [], ...props },
  ref,
) {
  const { palette } = useAppTheme()

  return (
    <Pressable ref={ref} {...props} className="rounded-[24px] border border-border bg-background/60 px-4 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">{eyebrow}</Text>
          <Text className="text-base font-semibold text-ink">{title}</Text>
          <Text className="text-sm leading-5 text-soft">{description}</Text>
        </View>
        <ChevronRight size={18} color={palette.muted} strokeWidth={2.1} />
      </View>

      {badges.length ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {badges.map((badge) => (
            <View key={badge} className="rounded-full border border-border bg-surface px-3 py-1.5">
              <Text className="text-[10px] font-semibold uppercase tracking-[1.2px] text-soft">{badge}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  )
})
