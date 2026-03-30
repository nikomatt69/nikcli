import { useEffect, useRef, useState } from "react"
import { Animated, LayoutAnimation, Pressable, ScrollView, Text, View } from "react-native"
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  Globe,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react-native"
import type { ToolPart } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

function toolIcon(toolName: string): LucideIcon {
  const value = toolName.toLowerCase()
  if (value.includes("bash") || value.includes("execute") || value.includes("shell") || value.includes("run")) {
    return SquareTerminal
  }
  if (value.includes("write") || value.includes("edit") || value.includes("read")) return FileCode2
  if (value.includes("glob") || value.includes("list")) return Folder
  if (value.includes("grep") || value.includes("search")) return Search
  if (value.includes("webfetch") || value.includes("websearch") || value.includes("fetch") || value.includes("http")) {
    return Globe
  }
  return Wrench
}

function statusDotColor(
  status: string,
  colors: { warn: string; success: string; danger: string; muted: string },
): string {
  if (status === "running") return colors.warn
  if (status === "completed") return colors.success
  if (status === "error") return colors.danger
  return colors.muted
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value || ""
  if (value === undefined || value === null) return ""

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function ToolCallView(props: { part: ToolPart }) {
  const { palette, isDark } = useAppTheme()
  const [open, setOpen] = useState(false)
  const [showAllOutput, setShowAllOutput] = useState(false)
  const state = props.part.state
  const status = state.status
  const Icon = toolIcon(props.part.tool)
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (status !== "running") {
      pulseAnim.setValue(1)
      return
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.25, duration: 520, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [status, pulseAnim])

  function toggle() {
    LayoutAnimation.configureNext({
      duration: 240,
      create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity, duration: 200 },
      update: { type: LayoutAnimation.Types.spring, springDamping: 0.8, duration: 240 },
      delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity, duration: 130 },
    })
    setOpen((value) => !value)
  }

  const title = status === "running" || status === "completed" ? state.title : undefined
  const timing =
    status === "completed" || status === "error" ? `${Math.max(0, state.time.end - state.time.start)}ms` : undefined
  const rawOutput = status === "completed" ? state.output : status === "error" ? state.error : undefined
  const output = typeof rawOutput === "string" ? rawOutput : rawOutput != null ? String(rawOutput) : ""
  const inputEntries = Object.entries(state.input ?? {})
  const statusLabel =
    status === "running" ? "Running" : status === "completed" ? "Completed" : status === "error" ? "Failed" : "Idle"
  const statusBackground =
    status === "running"
      ? isDark
        ? "rgba(183,183,183,0.08)"
        : "rgba(245,158,11,0.10)"
      : status === "completed"
        ? isDark
          ? "rgba(212,212,212,0.08)"
          : "rgba(34,197,94,0.10)"
        : status === "error"
          ? isDark
            ? "rgba(143,143,143,0.08)"
            : "rgba(239,68,68,0.10)"
          : isDark
            ? "rgba(255,255,255,0.05)"
            : "rgba(241,246,251,0.8)"
  const statusBorder =
    status === "running"
      ? isDark
        ? "rgba(183,183,183,0.16)"
        : "rgba(245,158,11,0.22)"
      : status === "completed"
        ? isDark
          ? "rgba(212,212,212,0.16)"
          : "rgba(34,197,94,0.22)"
        : status === "error"
          ? isDark
            ? "rgba(143,143,143,0.16)"
            : "rgba(239,68,68,0.22)"
          : isDark
            ? "rgba(255,255,255,0.08)"
            : "rgba(193,208,223,0.72)"

  return (
    <View
      className="min-w-0 overflow-hidden rounded-[20px] border"
      style={{
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.78)",
        backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,246,251,0.78)",
      }}
    >
      <Pressable
        className="flex-row items-center justify-between gap-3 px-3 py-3"
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${props.part.tool || "Tool"} ${open ? "details expanded" : "details collapsed"}`}
        accessibilityHint={open ? "Double tap to collapse tool details" : "Double tap to expand tool details"}
      >
        <View className="flex-1 flex-row items-center gap-2">
          <Animated.View
            style={{
              width: 8,
              height: 8,

              borderRadius: 4,
              opacity: status === "running" ? pulseAnim : 1,
              backgroundColor: statusDotColor(status, {
                warn: palette.warn,
                success: palette.success,
                danger: palette.danger,
                muted: palette.muted,
              }),
            }}
          />
          <Icon size={15} color={palette.accentLight} strokeWidth={2.1} />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
              {props.part.tool || "Unknown tool"}
            </Text>
            {title ? (
              <Text className="mt-0.5 text-[11px] leading-4 text-soft" numberOfLines={2}>
                {title}
              </Text>
            ) : null}
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: statusBorder,
              backgroundColor: statusBackground,
              paddingHorizontal: 9,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                color: status === "error" && !isDark ? palette.danger : palette.accentLight,
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              {statusLabel}
            </Text>
          </View>
          {timing ? (
            <View className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
              <Text className="text-[10px] text-soft" style={{ fontVariant: ["tabular-nums"] }}>
                {timing}
              </Text>
            </View>
          ) : null}
          {open ? (
            <ChevronDown size={14} color={palette.muted} strokeWidth={2.1} />
          ) : (
            <ChevronRight size={14} color={palette.muted} strokeWidth={2.1} />
          )}
        </View>
      </Pressable>
      {open ? (
        <View className="gap-3 border-t border-border px-3 py-2.5">
          {inputEntries.length > 0 ? (
            <View className="rounded-[16px] border border-border/70 bg-surface px-3 py-3">
              <Text className="mb-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">Input</Text>
              {inputEntries.map(([key, value]) => (
                <View key={key} className="mb-1 min-w-0 flex-row gap-2">
                  <Text className="shrink-0 font-mono text-xs text-soft">{key}:</Text>
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator
                    className="flex-1"
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{ alignSelf: "flex-start" }}
                  >
                    <Text selectable className="font-mono text-xs leading-5 text-soft">
                      {stringifyValue(value)}
                    </Text>
                  </ScrollView>
                </View>
              ))}
            </View>
          ) : null}
          {rawOutput !== undefined ? (
            <View className="rounded-[16px] border border-border/70 bg-surface px-3 py-3">
              <Text className="mb-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">
                Output
              </Text>
              <View className="overflow-hidden rounded-[12px] border border-border/70 bg-background/80 px-3 py-2.5">
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={{ alignSelf: "flex-start" }}
                >
                  <Text selectable className="font-mono text-xs leading-5 text-soft">
                    {showAllOutput ? output : output.slice(0, 400)}
                  </Text>
                </ScrollView>
              </View>
              {output.length > 400 ? (
                <Pressable onPress={() => setShowAllOutput((value) => !value)} className="mt-2">
                  <Text className="text-[11px] font-semibold text-accent-light">
                    {showAllOutput ? "Show less" : `Show all (${output.length} chars)`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
