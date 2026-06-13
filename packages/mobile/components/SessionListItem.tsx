import { useCallback, useEffect, useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { ArrowRight, Square, Trash2 } from "lucide-react-native"
import { InfoChip } from "@/components/ui/InfoChip"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
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

type SheetRowProps = {
  icon: React.ReactNode
  label: string
  description: string
  onPress(): void
  tone?: "accent" | "danger" | "neutral"
}

function SheetRow({ icon, label, description, onPress, tone = "accent" }: SheetRowProps) {
  const { palette, isDark } = useAppTheme()
  const scaleAnimRef = useRef<Animated.Value | null>(null)
  if (scaleAnimRef.current === null) scaleAnimRef.current = new Animated.Value(1)
  const scaleAnim = scaleAnimRef.current

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      damping: 20,
      stiffness: 280,
      mass: 0.85,
      useNativeDriver: true,
    }).start()
  }
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, damping: 18, stiffness: 300, mass: 0.8, useNativeDriver: true }).start()
  }

  const iconBg =
    tone === "danger"
      ? isDark
        ? "rgba(143,143,143,0.08)"
        : "rgba(239,68,68,0.10)"
      : tone === "neutral"
        ? isDark
          ? "rgba(148,163,184,0.09)"
          : "rgba(100,116,139,0.08)"
        : isDark
          ? "rgba(255,255,255,0.08)"
          : "rgba(14,165,233,0.09)"

  const iconBorder =
    tone === "danger"
      ? isDark
        ? "rgba(143,143,143,0.16)"
        : "rgba(239,68,68,0.22)"
      : tone === "neutral"
        ? isDark
          ? "rgba(148,163,184,0.18)"
          : "rgba(100,116,139,0.16)"
        : isDark
          ? "rgba(255,255,255,0.12)"
          : "rgba(14,165,233,0.18)"

  const labelColor = tone === "danger" ? palette.danger : palette.ink

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      <Animated.View
        style={{
          transform: [{ scale: scaleAnim }],
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          minHeight: 64,
          paddingHorizontal: 20,
          paddingVertical: 10,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: iconBg,
            borderWidth: 1,
            borderColor: iconBorder,
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: labelColor, lineHeight: 20 }} numberOfLines={1}>
            {label}
          </Text>
          <Text style={{ fontSize: 12.5, color: palette.muted, marginTop: 2, lineHeight: 16 }} numberOfLines={1}>
            {description}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
}

function SectionDivider() {
  return <View style={{ marginHorizontal: 20, marginTop: 8, height: 1, backgroundColor: "rgba(128,128,128,0.12)" }} />
}

type SessionActionsSheetProps = {
  sheetRef: React.RefObject<ActionSheetRef | null>
  title: string
  isBusy: boolean
  onStop(): void
  onDelete(): void
  onOpen(): void
}

function SessionListActionsSheet({ sheetRef, title, isBusy, onStop, onDelete, onOpen }: SessionActionsSheetProps) {
  const { palette, isDark } = useAppTheme()

  return (
    <ActionSheet ref={sheetRef} snapPoints={[340]}>
      {/* Header */}
      <View
        style={{
          borderBottomWidth: 1,
          borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
          paddingHorizontal: 20,
          paddingBottom: 16,
        }}
      >
        <Text
          style={{
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 1.8,
            color: palette.accent,
            textTransform: "uppercase",
          }}
        >
          Session actions
        </Text>
        <Text
          style={{ fontSize: 17, fontWeight: "700", color: palette.ink, marginTop: 6, lineHeight: 24 }}
          numberOfLines={2}
        >
          {title || "Untitled session"}
        </Text>
      </View>

      <View>
        <SheetRow
          icon={<ArrowRight size={19} color={palette.accentLight} strokeWidth={2.1} />}
          label="Open session"
          description="Jump to the session timeline"
          tone="accent"
          onPress={() => {
            sheetRef.current?.dismiss()
            setTimeout(onOpen, 120)
          }}
        />

        <SectionDivider />
        <SheetRow
          icon={<Square size={19} color={palette.soft} strokeWidth={2.1} />}
          label="Abort session"
          description={isBusy ? "Stop the active run immediately" : "No active run to abort"}
          tone="neutral"
          onPress={() => {
            sheetRef.current?.dismiss()
            setTimeout(onStop, 120)
          }}
        />

        <SectionDivider />
        <SheetRow
          icon={<Trash2 size={19} color={palette.danger} strokeWidth={2.1} />}
          label="Delete session"
          description="Permanently remove all data"
          tone="danger"
          onPress={() => {
            sheetRef.current?.dismiss()
            setTimeout(onDelete, 120)
          }}
        />
        <View style={{ height: 20 }} />
      </View>
    </ActionSheet>
  )
}

export function SessionListItem(props: {
  item: SessionSummary
  onPress(): void
  onDelete?: () => void
  onStop?: () => void
  index?: number
}) {
  const { palette, isDark } = useAppTheme()
  const status = props.item.status?.type ?? "idle"
  const summary = props.item.info.summary
  const translateYRef = useRef<Animated.Value | null>(null)
  if (translateYRef.current === null) translateYRef.current = new Animated.Value(10)
  const translateY = translateYRef.current
  const opacityRef = useRef<Animated.Value | null>(null)
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(0)
  const opacity = opacityRef.current
  const scaleRef = useRef<Animated.Value | null>(null)
  if (scaleRef.current === null) scaleRef.current = new Animated.Value(1)
  const scale = scaleRef.current
  const sheetRef = useRef<ActionSheetRef>(null)
  const badge = repoBadge(props.item)
  const containerBacked = Boolean(props.item.info.workspaceID)
  const changedFiles = (summary?.additions ?? 0) + (summary?.deletions ?? 0)
  const isBusy = status === "busy"

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

  const openSheet = useCallback(() => {
    sheetRef.current?.present()
  }, [])

  useEffect(() => {
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
        onLongPress={openSheet}
        delayLongPress={380}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        className="overflow-hidden border border-border bg-surface p-4"
        style={{
          borderRadius: 18,
          borderCurve: "continuous",
          shadowColor: palette.shadow,
          shadowOpacity: isDark ? 0.12 : 0.05,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1 gap-2">
            <Text className="text-[12px] text-muted">Updated {relativeTime(props.item.info.time.updated)}</Text>
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
              borderRadius: 999,
              borderWidth: 1,
              borderColor: statusColors.borderColor,
              backgroundColor: statusColors.backgroundColor,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: statusColors.dotColor }} />
            <Text style={{ color: statusColors.textColor, fontSize: 10, fontWeight: "700", letterSpacing: 0.4 }}>
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
        <View className="mt-3 flex-row justify-end">
          <Pressable
            onPress={(e) => {
              e.stopPropagation()
              openSheet()
            }}
            accessibilityRole="button"
            accessibilityLabel="Open session actions"
            hitSlop={10}
            className="rounded-full border border-border/70 bg-background/80 px-3 py-1.5"
          >
            <Text style={{ fontSize: 13, color: palette.muted, letterSpacing: 0.4 }}>•••</Text>
          </Pressable>
        </View>
      </Pressable>

      <SessionListActionsSheet
        sheetRef={sheetRef}
        title={props.item.info.title ?? ""}
        isBusy={isBusy}
        onOpen={props.onPress}
        onStop={props.onStop ?? (() => {})}
        onDelete={props.onDelete ?? (() => {})}
      />
    </Animated.View>
  )
}
