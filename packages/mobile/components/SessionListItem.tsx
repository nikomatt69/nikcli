import { useCallback, useEffect, useRef, useState } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { ArrowRight, Square, Trash2 } from "lucide-react-native"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import type { SessionSummary } from "@/lib/types"
import { relativeTime } from "@/lib/types"
import { hexToRgba, useAppTheme } from "@/lib/theme"

function sessionLocation(item: SessionSummary): string {
  const github = item.info.github
  if (github) {
    return github.repo || github.fullName || "Unknown repo"
  }

  const directory = item.info.directory?.trim()
  if (!directory) return "Unknown workspace"
  const segments = directory.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? directory
}

type SheetRowProps = {
  icon: React.ReactNode
  label: string
  description: string
  onPress(): void
  tone?: "accent" | "danger" | "neutral"
}

function SheetRow({ icon, label, description, onPress, tone = "accent" }: SheetRowProps) {
  const { palette } = useAppTheme()
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
      ? hexToRgba(palette.danger, 0.1)
      : tone === "neutral"
        ? hexToRgba(palette.muted, 0.09)
        : hexToRgba(palette.ink, 0.06)

  const iconBorder =
    tone === "danger"
      ? hexToRgba(palette.danger, 0.2)
      : tone === "neutral"
        ? hexToRgba(palette.muted, 0.18)
        : hexToRgba(palette.ink, 0.12)

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
  const { palette } = useAppTheme()
  return (
    <View style={{ marginHorizontal: 20, marginTop: 8, height: 1, backgroundColor: hexToRgba(palette.ink, 0.08) }} />
  )
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
  const { palette } = useAppTheme()

  return (
    <ActionSheet ref={sheetRef} snapPoints={[340]}>
      {/* Header */}
      <View
        style={{
          borderBottomWidth: 1,
          borderBottomColor: hexToRgba(palette.ink, 0.08),
          paddingHorizontal: 20,
          paddingBottom: 16,
        }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: "500",
            color: palette.muted,
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

function statusLabel(status: string, hasChanges: boolean): string {
  if (status === "busy") return "Working"
  if (status === "retry") return "Needs attention"
  return hasChanges ? "Done" : "No changes"
}

/**
 * Minimal Cursor-style list row: status dot, one-line title, and a meta line
 * "workspace · status · +N -M" with tinted diff counts. Actions live behind
 * long-press (unchanged sheet).
 */
export function SessionListItem(props: {
  item: SessionSummary
  onPress(): void
  onDelete?: () => void
  onStop?: () => void
  index?: number
}) {
  const { palette } = useAppTheme()
  const status = props.item.status?.type ?? "idle"
  const summary = props.item.info.summary
  const opacityRef = useRef<Animated.Value | null>(null)
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(0)
  const opacity = opacityRef.current
  const [pressed, setPressed] = useState(false)
  const sheetRef = useRef<ActionSheetRef>(null)
  const additions = summary?.additions ?? 0
  const deletions = summary?.deletions ?? 0
  const hasChanges = additions + deletions > 0
  const isBusy = status === "busy"

  const dotColor =
    status === "busy"
      ? palette.secondary
      : status === "retry"
        ? palette.danger
        : hasChanges
          ? palette.secondary
          : hexToRgba(palette.ink, 0.25)

  const openSheet = useCallback(() => {
    sheetRef.current?.present()
  }, [])

  useEffect(() => {
    opacity.setValue(0)
    const delay = Math.min(props.index ?? 0, 8) * 25
    const animation = Animated.timing(opacity, { toValue: 1, duration: 200, delay, useNativeDriver: true })
    animation.start()
    return () => animation.stop()
  }, [opacity, props.index])

  return (
    <Animated.View style={{ opacity }}>
      <Pressable
        onPress={props.onPress}
        onLongPress={openSheet}
        delayLongPress={380}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 4,
          borderRadius: 12,
          backgroundColor: pressed ? hexToRgba(palette.ink, 0.04) : "transparent",
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dotColor, marginTop: 6 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text className="text-[15px] font-semibold leading-5 text-ink" numberOfLines={1}>
            {props.item.info.title || "Untitled session"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Text className="text-[13px] text-muted" numberOfLines={1}>
              {sessionLocation(props.item)}
              {" · "}
              {statusLabel(status, hasChanges)}
            </Text>
            {hasChanges ? (
              <Text className="text-[13px] text-muted" numberOfLines={1}>
                {" · "}
                <Text style={{ color: palette.success, fontVariant: ["tabular-nums"] }}>+{additions}</Text>{" "}
                <Text style={{ color: palette.danger, fontVariant: ["tabular-nums"] }}>-{deletions}</Text>
              </Text>
            ) : null}
            <Text className="text-[13px] text-muted" numberOfLines={1}>
              {" · "}
              {relativeTime(props.item.info.time.updated)}
            </Text>
          </View>
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
