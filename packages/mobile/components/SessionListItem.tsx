import { useCallback, useEffect, useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { Ellipsis, Trash2 } from "lucide-react-native"
import type { SessionSummary } from "@/lib/types"
import { relativeTime } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

function statusTone(status: string) {
  if (status === "busy") return "border-accent/30 bg-accent/12 text-accent-light"
  if (status === "retry") return "border-danger/30 bg-danger/12 text-rose-200"
  return "border-success/25 bg-success/12 text-emerald-200"
}

function sessionLocation(item: SessionSummary): string {
  const github = item.info.github
  if (github) {
    const repo = github.fullName || github.repo || "Unknown repo"
    const branch = github.headBranch || github.baseBranch || "unknown-branch"
    return `${repo} -> ${branch}`
  }

  const directory = item.info.directory?.trim()
  return directory || "Unknown workspace"
}

function repoBadge(item: SessionSummary): string | null {
  const github = item.info.github
  if (!github) return null
  const repo = github.repo || github.fullName || "Unknown repo"
  const branch = github.baseBranch || github.headBranch || "unknown-branch"
  return `${repo}:${branch}`
}

export function SessionListItem(props: {
  item: SessionSummary
  onPress(): void
  onLongPress?: () => void
  onDelete?: () => void
  index?: number
}) {
  const { palette } = useAppTheme()
  const status = props.item.status?.type ?? "idle"
  const summary = props.item.info.summary
  const translateY = useRef(new Animated.Value(10)).current
  const opacity = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(1)).current
  const badge = repoBadge(props.item)
  const containerBacked = Boolean(props.item.info.workspaceID)

  const onPressIn = useCallback(() => {
    Animated.spring(scale, { toValue: 0.978, useNativeDriver: true, speed: 60, bounciness: 0 }).start()
  }, [scale])

  const onPressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 3 }).start()
  }, [scale])

  useEffect(() => {
    const delay = (props.index ?? 0) * 30
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, delay, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: 0,
        delay,
        damping: 18,
        stiffness: 190,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ]).start()
  }, [opacity, props.index, translateY])

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }, { scale }] }}>
      <Pressable
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        className="rounded-[30px] border border-border bg-surface px-4 py-4"
        style={{
          shadowColor: palette.shadow,
          shadowOpacity: 0.18,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 12 },
        }}
      >
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1 gap-2">
            <Text className="text-[11px] font-semibold uppercase tracking-[2.2px] text-accent-light">Execution</Text>
            <Text className="text-base font-semibold text-ink">{props.item.info.title || "Untitled session"}</Text>
            <Text className="text-sm leading-5 text-soft">{sessionLocation(props.item)}</Text>
          </View>
          <View className={`rounded-full border px-3 py-1.5 ${statusTone(status)}`}>
            <Text className="text-[10px] font-semibold uppercase tracking-[1.8px]">{status}</Text>
          </View>
        </View>
        <View className="mt-4 flex-row flex-wrap gap-2">
          <View className="rounded-full border border-border/60 bg-background/80 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">{summary?.files ?? 0} files</Text>
          </View>
          <View className="rounded-full border border-border/60 bg-background/80 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">
              +{summary?.additions ?? 0} / -{summary?.deletions ?? 0}
            </Text>
          </View>
          {containerBacked ? (
            <View className="rounded-full border border-accent/20 bg-accent/10 px-3 py-2">
              <Text className="text-[11px] font-semibold text-accent-light">container</Text>
            </View>
          ) : null}
          {badge ? (
            <View className="rounded-full border border-accent/20 bg-accent/10 px-3 py-2">
              <Text className="text-[11px] font-semibold text-accent-light">{badge}</Text>
            </View>
          ) : null}
        </View>
        <View className="mt-4 flex-row items-center justify-between border-t border-border/80 pt-3">
          <Text className="text-xs text-soft">Updated {relativeTime(props.item.info.time.updated)}</Text>
          <View className="flex-row items-center gap-2">
            {props.onDelete ? (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation()
                  props.onDelete?.()
                }}
                hitSlop={10}
                className="rounded-full border border-danger/35 bg-danger/10 px-3 py-2"
              >
                <Trash2 size={14} color={palette.danger} strokeWidth={2.1} />
              </Pressable>
            ) : null}
            <Text className="text-xs font-semibold uppercase tracking-[1.5px] text-accent-light">Open</Text>
            {props.onLongPress ? <Ellipsis size={14} color={palette.muted} strokeWidth={2.1} /> : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}
