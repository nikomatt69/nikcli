import { useEffect, useRef, useState } from "react"
import { Animated, LayoutAnimation, Pressable, ScrollView, Text, View } from "react-native"
import { FileCode2, Folder, Globe, Search, SquareTerminal, Wrench, type LucideIcon } from "lucide-react-native"
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
  const { palette } = useAppTheme()
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
  const output = rawOutput ?? ""
  const inputEntries = Object.entries(state.input ?? {})

  return (
    <View className="min-w-0 overflow-hidden rounded-[18px] border border-border bg-background/75">
      <Pressable
        className="flex-row items-center justify-between gap-3 px-3 py-2.5"
        onPress={toggle}
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
          {timing ? (
            <View className="mr-2 rounded-full border border-border/60 bg-background/80 px-2 py-0.5">
              <Text className="text-[10px] text-soft">{timing}</Text>
            </View>
          ) : null}
        </View>
        <Text className="text-[11px] font-semibold uppercase tracking-[1.7px] text-soft">{open ? "Hide" : "Show"}</Text>
      </Pressable>
      {open ? (
        <View className="gap-3 border-t border-border px-3 py-2.5">
          {inputEntries.length > 0 ? (
            <View>
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
            <View>
              <Text className="mb-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">
                Output
              </Text>
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
