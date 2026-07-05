import type { RefObject } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import {
  Braces,
  Copy,
  FileText,
  MonitorPlay,
  PencilLine,
  Rocket,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react-native"
import { router } from "expo-router"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { useAppTheme } from "@/lib/theme"
import { useRef } from "react"

type Props = {
  sheetRef: RefObject<ActionSheetRef | null>
  title: string
  onRename(): void
  onExportMarkdown(): void
  onExportJSON(): void
  onCopyID(): void
  onTeleport?(): void
  onOpenTerminal?(): void
  onOpenPreview?(): void
}

type RowProps = {
  Icon: LucideIcon
  label: string
  description: string
  onPress(): void
  tone?: "accent" | "success" | "neutral"
}

function SheetRow({ Icon, label, description, onPress, tone = "accent" }: RowProps) {
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
    Animated.spring(scaleAnim, {
      toValue: 1,
      damping: 18,
      stiffness: 300,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  const iconBg =
    tone === "success"
      ? isDark
        ? "rgba(255,255,255,0.06)"
        : "rgba(22,163,74,0.09)"
      : tone === "neutral"
        ? isDark
          ? "rgba(117,116,110,0.09)"
          : "rgba(90,89,84,0.08)"
        : isDark
          ? "rgba(255,255,255,0.08)"
          : "rgba(20,20,19,0.09)"

  const iconBorder =
    tone === "success"
      ? isDark
        ? "rgba(255,255,255,0.1)"
        : "rgba(22,163,74,0.20)"
      : tone === "neutral"
        ? isDark
          ? "rgba(117,116,110,0.18)"
          : "rgba(90,89,84,0.16)"
        : isDark
          ? "rgba(255,255,255,0.12)"
          : "rgba(20,20,19,0.18)"

  const iconColor = tone === "success" ? palette.success : tone === "neutral" ? palette.soft : palette.accentLight

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
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
          className="shrink-0 items-center justify-center rounded-[14px]"
          style={{
            width: 44,
            height: 44,
            backgroundColor: iconBg,
            borderWidth: 1,
            borderColor: iconBorder,
          }}
        >
          <Icon size={19} color={iconColor} strokeWidth={2.1} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold leading-5 tracking-tight text-ink" numberOfLines={1}>
            {label}
          </Text>
          <Text className="mt-0.5 text-[12.5px] leading-4 text-muted" numberOfLines={1}>
            {description}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
}

function SectionLabel({ label }: { label: string }) {
  return <Text className="px-5 pb-1 pt-3.5 text-[12px] font-medium text-muted">{label}</Text>
}

function SectionDivider() {
  return <View className="mx-5 mt-2 h-px bg-border" />
}

export function SessionActionsSheet({
  sheetRef,
  title,
  onRename,
  onExportMarkdown,
  onExportJSON,
  onCopyID,
  onTeleport,
  onOpenTerminal,
  onOpenPreview,
}: Props) {
  const { palette, isDark } = useAppTheme()

  return (
    <ActionSheet ref={sheetRef} snapPoints={["86%"]}>
      {/* Header */}
      <View className="border-b border-border px-5 pb-4">
        <Text className="text-[12px] font-medium text-muted">Session actions</Text>
        <Text className="mt-1.5 text-lg font-bold leading-6 tracking-tight text-ink" numberOfLines={2}>
          {title || "Untitled session"}
        </Text>
        <View
          className="mt-2 self-start rounded-full px-2.5 py-1"
          style={{
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(20,20,19,0.18)",
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(20,20,19,0.09)",
          }}
        >
          <Text className="text-[10px] font-semibold tracking-wide" style={{ color: palette.accentLight }}>
            Choose an action
          </Text>
        </View>
      </View>

      {/* Rows — plain View, no ScrollView (avoids flex collapse inside ActionSheet) */}
      <View>
        <SectionLabel label="Session" />
        <SheetRow
          Icon={PencilLine}
          label="Rename session"
          description="Update the title of this session"
          onPress={onRename}
          tone="accent"
        />
        {onTeleport ? (
          <SheetRow
            Icon={Rocket}
            label="Teleport session"
            description="Copy this session to another nikcli server"
            onPress={onTeleport}
            tone="accent"
          />
        ) : null}

        <SectionDivider />
        <SectionLabel label="Export" />
        <SheetRow
          Icon={FileText}
          label="Export as Markdown"
          description="Full transcript formatted as .md"
          onPress={onExportMarkdown}
          tone="success"
        />
        <SheetRow
          Icon={Braces}
          label="Export as JSON"
          description="Raw session data with all metadata"
          onPress={onExportJSON}
          tone="success"
        />

        <SectionDivider />
        <SectionLabel label="Preview" />
        <SheetRow
          Icon={MonitorPlay}
          label="Session preview"
          description="Project folder and dev URLs from this chat"
          onPress={() => {
            onOpenPreview?.()
            setTimeout(() => sheetRef.current?.dismiss(), 120)
          }}
          tone="accent"
        />

        <SectionDivider />
        <SectionLabel label="Tools" />
        <SheetRow
          Icon={TerminalSquare}
          label="Open terminal"
          description="Launch a shell on the nikcli server"
          onPress={() => {
            sheetRef.current?.dismiss()
            if (onOpenTerminal) {
              onOpenTerminal()
            } else {
              router.push("/terminal" as Parameters<typeof router.push>[0])
            }
          }}
          tone="neutral"
        />

        <SectionDivider />
        <SectionLabel label="Share" />
        <SheetRow
          Icon={Copy}
          label="Copy session ID"
          description="For sharing, API calls, or log traces"
          onPress={onCopyID}
          tone="neutral"
        />
        <View className="h-5" />
      </View>
    </ActionSheet>
  )
}
