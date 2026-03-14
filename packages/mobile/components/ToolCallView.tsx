import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { ToolPart } from "@/lib/types"

type IoniconName = React.ComponentProps<typeof Ionicons>["name"]

function toolIcon(toolName: string): IoniconName {
  const t = toolName.toLowerCase()
  if (t.includes("bash") || t.includes("execute") || t.includes("shell") || t.includes("run")) return "terminal-outline"
  if (t.includes("write") || t.includes("edit")) return "pencil-outline"
  if (t.includes("read")) return "document-text-outline"
  if (t.includes("glob") || t.includes("list")) return "folder-outline"
  if (t.includes("grep") || t.includes("search")) return "search-outline"
  if (t.includes("webfetch") || t.includes("websearch") || t.includes("fetch") || t.includes("http")) return "globe-outline"
  return "construct-outline"
}

function statusDotColor(status: string): string {
  if (status === "running") return "#f59e0b"
  if (status === "completed") return "#34d399"
  if (status === "error") return "#fb7185"
  return "#64748b"
}

export function ToolCallView(props: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const [showAllOutput, setShowAllOutput] = useState(false)
  const state = props.part.state
  const status = state.status

  const title =
    status === "running" ? state.title : status === "completed" ? state.title : undefined
  const timing =
    status === "completed" || status === "error"
      ? `${state.time.end - state.time.start}ms`
      : undefined
  const rawOutput =
    status === "completed" ? state.output : status === "error" ? state.error : undefined
  const inputEntries = Object.entries(state.input ?? {})

  return (
    <View className="mt-3 rounded-2xl border border-border bg-background/70">
      <Pressable className="flex-row items-center justify-between px-3 py-3" onPress={() => setOpen((v) => !v)}>
        <View className="flex-1 flex-row items-center gap-2">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusDotColor(status) }} />
          <Ionicons name={toolIcon(props.part.tool)} size={14} color="#7dd3fc" />
          <View className="flex-1">
            <Text className="text-sm font-semibold text-ink">{props.part.tool}</Text>
            {title ? <Text className="mt-0.5 text-[11px] text-soft">{title}</Text> : null}
          </View>
          {timing ? (
            <View className="mr-2 rounded-full bg-background/70 px-2 py-0.5">
              <Text className="text-[10px] text-soft">{timing}</Text>
            </View>
          ) : null}
        </View>
        <Text className="text-[11px] font-semibold uppercase tracking-[1.7px] text-soft">
          {open ? "Hide" : "Show"}
        </Text>
      </Pressable>
      {open ? (
        <View className="gap-3 border-t border-border px-3 py-3">
          {inputEntries.length > 0 ? (
            <View>
              <Text className="mb-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">
                Input
              </Text>
              {inputEntries.map(([key, value]) => (
                <View key={key} className="mb-1 flex-row gap-2">
                  <Text className="shrink-0 font-mono text-xs text-soft">{key}:</Text>
                  <Text className="flex-1 font-mono text-xs leading-5 text-soft">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {rawOutput !== undefined ? (
            <View>
              <Text className="mb-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">
                Output
              </Text>
              <Text className="font-mono text-xs leading-5 text-soft">
                {showAllOutput ? rawOutput : rawOutput.slice(0, 400)}
              </Text>
              {rawOutput.length > 400 ? (
                <Pressable onPress={() => setShowAllOutput((v) => !v)} className="mt-2">
                  <Text className="text-[11px] font-semibold text-accent-light">
                    {showAllOutput ? "Show less" : `Show all (${rawOutput.length} chars)`}
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
