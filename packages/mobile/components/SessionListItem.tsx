import { useCallback, useRef, useState } from "react"
import { Alert, Animated, Pressable, Text, View } from "react-native"
import { ArrowRight, Cloud, Square, Trash2 } from "lucide-react-native"
import { SessionGlyph, type SessionGlyphKind } from "@/components/session/SessionGlyph"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { usePressAnimation } from "@/lib/animation"
import type { SessionSummary } from "@/lib/types"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

function lastPathSegment(path?: string | null): string | null {
  if (!path) return null
  const segments = path.split("/").filter((part) => part.length > 0 && part !== ".")
  return segments[segments.length - 1] ?? null
}

export function sessionLocation(item: SessionSummary, fallback?: string): string {
  const github = item.info.github
  const fromGithub = github?.repo || github?.fullName
  if (fromGithub) return fromGithub

  return lastPathSegment(item.info.directory) ?? lastPathSegment(fallback) ?? "Unknown workspace"
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
  const press = usePressAnimation()

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
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ alignSelf: "stretch" }}
    >
      <Animated.View style={{ alignSelf: "stretch", transform: [{ scale: press.scale }] }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "stretch",
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
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              backgroundColor: iconBg,
              borderWidth: 1,
              borderColor: iconBorder,
            }}
          >
            {icon}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: labelColor, ...typeStyle(15, { weight: "600" }) }} numberOfLines={1}>
              {label}
            </Text>
            <Text style={{ color: palette.muted, marginTop: 2, ...typeStyle(13) }} numberOfLines={1}>
              {description}
            </Text>
          </View>
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
      <View
        style={{
          alignSelf: "stretch",
          width: "100%",
          borderBottomWidth: 1,
          borderBottomColor: hexToRgba(palette.ink, 0.08),
          paddingHorizontal: 20,
          paddingBottom: 16,
        }}
      >
        <Text style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>Session actions</Text>
        <Text style={{ color: palette.ink, marginTop: 6, ...typeStyle(17, { weight: "700" }) }} numberOfLines={2}>
          {title || "Untitled session"}
        </Text>
      </View>

      <View style={{ alignSelf: "stretch", width: "100%" }}>
        <SheetRow
          icon={<ArrowRight size={19} color={palette.accentLight} strokeWidth={2.1} />}
          label="Open session"
          description="Jump to the session timeline"
          tone="accent"
          onPress={() => {
            sheetRef.current?.dismiss(onOpen)
          }}
        />

        <SectionDivider />
        <SheetRow
          icon={<Square size={19} color={palette.soft} strokeWidth={2.1} />}
          label="Abort session"
          description={isBusy ? "Stop the active run immediately" : "No active run to abort"}
          tone="neutral"
          onPress={() => {
            sheetRef.current?.dismiss(onStop)
          }}
        />

        <SectionDivider />
        <SheetRow
          icon={<Trash2 size={19} color={palette.danger} strokeWidth={2.1} />}
          label="Delete session"
          description="Permanently remove all data"
          tone="danger"
          onPress={() => {
            sheetRef.current?.dismiss(() => {
              Alert.alert(
                "Delete session?",
                `"${title || "Untitled session"}" and its local data will be permanently removed.`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: onDelete },
                ],
              )
            })
          }}
        />
        <View style={{ height: 20 }} />
      </View>
    </ActionSheet>
  )
}

function sessionBranch(item: SessionSummary): string | undefined {
  return item.info.github?.worktree.branch ?? item.info.worktree?.branch
}

function glyphKind(status: string, branch: string | undefined): SessionGlyphKind {
  if (status === "busy") return "busy"
  if (status === "retry") return "attention"
  return branch ? "branch" : "idle"
}

/**
 * A session row: glyph, title, and one quiet meta line in the Code-screen
 * shape — "New · repo ☁" / "Interrupted · repo ☁" / "repo · +N -M ☁" — with
 * an unread dot on the trailing edge. Actions live behind long-press.
 */
export function SessionListItem(props: {
  item: SessionSummary
  onPress(): void
  onDelete?: () => void
  onStop?: () => void
  unread?: boolean
  isNew?: boolean
  locationFallback?: string
}) {
  const { palette } = useAppTheme()
  const status = props.item.status?.type ?? "idle"
  const summary = props.item.info.summary
  const [pressed, setPressed] = useState(false)
  const press = usePressAnimation()
  const sheetRef = useRef<ActionSheetRef>(null)
  const additions = summary?.additions ?? 0
  const deletions = summary?.deletions ?? 0
  const hasChanges = additions + deletions > 0
  const isBusy = status === "busy"
  const interrupted = status === "retry"

  const branch = sessionBranch(props.item)
  const prefix = interrupted ? "Interrupted" : props.isNew ? "New" : null
  const location = sessionLocation(props.item, props.locationFallback)

  const openSheet = useCallback(() => {
    sheetRef.current?.present()
  }, [])

  return (
    <View>
      <Animated.View style={{ alignSelf: "stretch", transform: [{ scale: press.scale }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.item.info.title || "Untitled session"}
          accessibilityHint="Opens the session. Long press for session actions."
          onPress={props.onPress}
          onLongPress={openSheet}
          delayLongPress={380}
          onPressIn={() => {
            setPressed(true)
            press.onPressIn()
          }}
          onPressOut={() => {
            setPressed(false)
            press.onPressOut()
          }}
          style={{ alignSelf: "stretch" }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              paddingVertical: 13,
              paddingHorizontal: 4,
              minHeight: 44,
              borderRadius: 12,
              borderCurve: "continuous",
              backgroundColor: pressed ? hexToRgba(palette.ink, 0.04) : "transparent",
            }}
          >
            <View style={{ width: 16, alignItems: "center", marginTop: 3 }}>
              <SessionGlyph kind={glyphKind(status, branch)} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={{ color: palette.ink, ...typeStyle(17, { weight: "600" }) }} numberOfLines={1}>
                {props.item.info.title || "Untitled session"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 6, rowGap: 2 }}>
                {prefix ? (
                  <Text style={{ color: palette.muted, ...typeStyle(13) }}>
                    {prefix}
                    {" · "}
                  </Text>
                ) : null}
                <Text style={{ color: palette.muted, ...typeStyle(13) }} numberOfLines={1}>
                  {location}
                </Text>
                {hasChanges ? (
                  <Text style={{ color: palette.muted, ...typeStyle(13) }}>
                    {"· "}
                    <Text style={{ color: palette.success, fontVariant: ["tabular-nums"] }}>+{additions}</Text>
                    {" "}
                    <Text style={{ color: palette.danger, fontVariant: ["tabular-nums"] }}>-{deletions}</Text>
                  </Text>
                ) : null}
                <Cloud size={13} color={palette.muted} strokeWidth={2} />
              </View>
            </View>
            {props.unread ? (
              <View
                accessibilityLabel="Unread"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  marginTop: 8,
                  backgroundColor: palette.accent,
                }}
              />
            ) : null}
          </View>
        </Pressable>
      </Animated.View>

      <SessionListActionsSheet
        sheetRef={sheetRef}
        title={props.item.info.title ?? ""}
        isBusy={isBusy}
        onOpen={props.onPress}
        onStop={props.onStop ?? (() => {})}
        onDelete={props.onDelete ?? (() => {})}
      />
    </View>
  )
}
