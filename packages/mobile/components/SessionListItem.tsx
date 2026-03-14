import { Pressable, Text, View } from "react-native"
import Animated, { FadeInLeft } from "react-native-reanimated"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as Haptics from "expo-haptics"
import type { SessionSummary } from "@/lib/types"
import { relativeTime } from "@/lib/types"

function statusTone(status: string) {
  if (status === "busy") return "border-accent/30 bg-accent/10 text-accent-light"
  if (status === "retry") return "border-danger/30 bg-danger/10 text-rose-200"
  return "border-success/25 bg-success/10 text-emerald-200"
}

export function SessionListItem(props: {
  item: SessionSummary
  onPress(): void
  onLongPress?: () => void
  onDelete?: () => void
  index?: number
}) {
  const status = props.item.status?.type ?? "idle"
  const summary = props.item.info.summary
  const delay = (props.index ?? 0) * 30

  return (
    <Animated.View entering={FadeInLeft.delay(delay).springify()}>
      <Pressable
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        className="rounded-[28px] border border-border bg-surface px-4 py-4 active:opacity-80"
        style={{
          shadowColor: "#020617",
          shadowOpacity: 0.22,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1 gap-2">
            <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Execution</Text>
            <Text className="text-base font-semibold text-ink">{props.item.info.title || "Untitled session"}</Text>
            <Text className="text-sm leading-5 text-soft">{props.item.info.directory}</Text>
          </View>
          <View className={`rounded-full border px-3 py-1 ${statusTone(status)}`}>
            <Text className="text-[10px] font-semibold uppercase tracking-[1.8px]">{status}</Text>
          </View>
        </View>
        <View className="mt-4 flex-row gap-2">
          <View className="rounded-full bg-background/70 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">{summary?.files ?? 0} files</Text>
          </View>
          <View className="rounded-full bg-background/70 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">
              +{summary?.additions ?? 0} / -{summary?.deletions ?? 0}
            </Text>
          </View>
        </View>
        <View className="mt-4 flex-row items-center justify-between border-t border-border pt-3">
          <Text className="text-xs text-soft">Updated {relativeTime(props.item.info.time.updated)}</Text>
          <View className="flex-row items-center gap-2">
            {props.onDelete ? (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation()
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                  props.onDelete?.()
                }}
                hitSlop={10}
                className="rounded-full border border-danger/35 bg-danger/10 px-3 py-2"
              >
                <Ionicons name="trash-outline" size={14} color="#fca5a5" />
              </Pressable>
            ) : null}
            <Text className="text-xs font-semibold uppercase tracking-[1.5px] text-accent-light">Open</Text>
            {props.onLongPress ? <Ionicons name="ellipsis-horizontal" size={14} color="#4a6a85" /> : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}
