import type { RefObject } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { Braces, Copy, FileText, PencilLine, type LucideIcon } from "lucide-react-native"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { useAppTheme } from "@/lib/theme"
import { useRef } from "react"

type Props = {
  sheetRef: RefObject<ActionSheetRef>
  title: string
  onRename(): void
  onExportMarkdown(): void
  onExportJSON(): void
  onCopyID(): void
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
  const scaleAnim = useRef(new Animated.Value(1)).current

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
          ? "rgba(148,163,184,0.09)"
          : "rgba(100,116,139,0.08)"
        : isDark
          ? "rgba(255,255,255,0.08)"
          : "rgba(14,165,233,0.09)"

  const iconBorder =
    tone === "success"
      ? isDark
        ? "rgba(255,255,255,0.1)"
        : "rgba(22,163,74,0.20)"
      : tone === "neutral"
        ? isDark
          ? "rgba(148,163,184,0.18)"
          : "rgba(100,116,139,0.16)"
        : isDark
          ? "rgba(255,255,255,0.12)"
          : "rgba(14,165,233,0.18)"

  const iconColor = tone === "success" ? palette.success : tone === "neutral" ? palette.soft : palette.accentLight

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.97 : scaleAnim }], opacity: pressed ? 0.7 : 1 }]}
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
      <View className="flex-1">
        <Text className="text-[15px] font-semibold leading-5 tracking-tight text-ink" numberOfLines={1}>
          {label}
        </Text>
        <Text className="mt-0.5 text-[12.5px] leading-4 text-muted" numberOfLines={1}>
          {description}
        </Text>
      </View>
    </Pressable>
  )
}

function SectionLabel({ label }: { label: string }) {
  return <Text className="px-5 pb-1 pt-3.5 text-[10px] font-bold uppercase tracking-[1.6px] text-muted">{label}</Text>
}

function SectionDivider() {
  return <View className="mx-5 mt-2 h-px bg-border" />
}

export function SessionActionsSheet({ sheetRef, title, onRename, onExportMarkdown, onExportJSON, onCopyID }: Props) {
  const { palette, isDark } = useAppTheme()

  return (
    <ActionSheet ref={sheetRef} snapPoints={["86%"]}>
      {/* Header */}
      <View className="border-b border-border px-5 pb-4">
        <Text className="text-[10px] font-bold uppercase tracking-[1.8px] text-accent">Session actions</Text>
        <Text className="mt-1.5 text-lg font-bold leading-6 tracking-tight text-ink" numberOfLines={2}>
          {title || "Untitled session"}
        </Text>
        <View
          className="mt-2 self-start rounded-full px-2.5 py-1"
          style={{
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.18)",
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(14,165,233,0.09)",
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
