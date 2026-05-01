import { useCallback, useEffect, useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { ArrowRight, Ellipsis, Trash2 } from "lucide-react-native"
import { InfoChip } from "@/components/ui/InfoChip"
import type { SessionSummary } from "@/lib/types"
import { relativeTime } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

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
  const { palette, isDark } = useAppTheme()
  const status = props.item.status?.type ?? "idle"
  const summary = props.item.info.summary
  const translateY = useRef(new Animated.Value(10)).current
  const opacity = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(1)).current
  const badge = repoBadge(props.item)
  const containerBacked = Boolean(props.item.info.workspaceID)
  const changedFiles = (summary?.additions ?? 0) + (summary?.deletions ?? 0)
  const footerLabel =
    status === "busy"
      ? "Execution is active and streaming new output"
      : status === "retry"
        ? "Needs attention before the next run can continue"
        : "Ready for transcript, approvals, and publish review"
  const statusColors =
    status === "busy"
      ? {
          backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.10)",
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.18)",
          textColor: palette.accentLight,
          dotColor: palette.accent,
        }
      : status === "retry"
        ? {
            backgroundColor: isDark ? "rgba(143,143,143,0.08)" : "rgba(239,68,68,0.10)",
            borderColor: isDark ? "rgba(143,143,143,0.16)" : "rgba(239,68,68,0.22)",
            textColor: isDark ? palette.ink : palette.danger,
            dotColor: palette.danger,
          }
        : {
            backgroundColor: isDark ? "rgba(212,212,212,0.08)" : "rgba(34,197,94,0.10)",
            borderColor: isDark ? "rgba(212,212,212,0.16)" : "rgba(34,197,94,0.20)",
            textColor: palette.accentLight,
            dotColor: palette.success,
          }

  const onPressIn = useCallback(() => {
    scale.stopAnimation()
    Animated.spring(scale, { toValue: 0.978, useNativeDriver: true, speed: 60, bounciness: 0 }).start()
  }, [scale])

  const onPressOut = useCallback(() => {
    scale.stopAnimation()
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 3 }).start()
  }, [scale])

  useEffect(() => {
    // Reset to initial state to ensure clean entrance animation on remount
    opacity.setValue(0)
    translateY.setValue(10)
    const delay = (props.index ?? 0) * 30
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, delay, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: 0,
        delay,
        damping: 18,
        stiffness: 190,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ])
    animation.start()
    return () => animation.stop()
  }, [opacity, props.index, translateY])

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }, { scale }] }}>
      <Pressable
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        className="overflow-hidden rounded-[8px] border border-border bg-surface px-4 py-4"
        style={{
          shadowColor: palette.shadow,
          shadowOpacity: isDark ? 0.24 : 0.14,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1 gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[11px] font-semibold uppercase tracking-[1.9px] text-accent-light">Execution</Text>
              <Text className="text-[11px] text-muted">Updated {relativeTime(props.item.info.time.updated)}</Text>
            </View>
            <Text selectable className="text-[17px] font-semibold leading-[22px] text-ink" numberOfLines={2}>
              {props.item.info.title || "Untitled session"}
            </Text>
            <Text selectable className="text-sm leading-5 text-soft" numberOfLines={2}>
              {sessionLocation(props.item)}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: statusColors.borderColor,
              backgroundColor: statusColors.backgroundColor,
              paddingHorizontal: 10,
              paddingVertical: 7,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                backgroundColor: statusColors.dotColor,
              }}
            />
            <Text style={{ color: statusColors.textColor, fontSize: 10, fontWeight: "700", letterSpacing: 1.2 }}>
              {status.toUpperCase()}
            </Text>
          </View>
        </View>
        <View className="mt-4 flex-row flex-wrap gap-2">
          <InfoChip label={`${summary?.files ?? 0} files`} />
          <InfoChip
            label={`+${summary?.additions ?? 0} / -${summary?.deletions ?? 0}`}
            tone={changedFiles ? "accent" : "neutral"}
          />
          {containerBacked ? <InfoChip label="Container sandbox" tone="accent" /> : null}
          {badge ? <InfoChip label={badge} tone="accent" /> : null}
        </View>
        <View className="mt-4 flex-row items-center justify-between border-t border-border/80 pt-3">
          <Text selectable className="text-xs text-soft">
            {footerLabel}
          </Text>
          <View className="flex-row items-center gap-2">
            {props.onDelete ? (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation()
                  props.onDelete?.()
                }}
                hitSlop={10}
                className="rounded-[8px] border border-danger/35 bg-danger/10 px-3 py-2"
              >
                <Trash2 size={14} color={palette.danger} strokeWidth={2.1} />
              </Pressable>
            ) : null}
            <View className="flex-row items-center gap-1 rounded-[8px] border border-border/70 bg-background/80 px-3 py-2">
              <Text className="text-[11px] font-semibold uppercase tracking-[1.2px] text-accent-light">Open</Text>
              <ArrowRight size={13} color={palette.accentLight} strokeWidth={2.1} />
            </View>
            {props.onLongPress ? <Ellipsis size={14} color={palette.muted} strokeWidth={2.1} /> : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}
