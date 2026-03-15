import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import type { FileDiff } from "@/lib/types"

function renderLines(before: string, after: string) {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  const max = Math.max(beforeLines.length, afterLines.length)
  const result: Array<{ kind: "same" | "add" | "remove"; text: string }> = []

  for (let index = 0; index < max; index++) {
    const left = beforeLines[index] ?? ""
    const right = afterLines[index] ?? ""
    if (left === right) {
      result.push({ kind: "same", text: `  ${right}` })
      continue
    }
    if (left) result.push({ kind: "remove", text: `- ${left}` })
    if (right) result.push({ kind: "add", text: `+ ${right}` })
  }

  return result
}

function fileStatus(diff: FileDiff): { label: string; style: string } {
  if (diff.before === "") return { label: "added", style: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" }
  if (diff.after === "") return { label: "deleted", style: "border-rose-500/40 bg-rose-500/10 text-rose-300" }
  return { label: "modified", style: "border-sky-500/40 bg-sky-500/10 text-sky-300" }
}

export function DiffViewer(props: { diffs: FileDiff[] }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  function toggle(file: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  return (
    <View className="mt-3 gap-2">
      {props.diffs.map((diff) => {
        const status = fileStatus(diff)
        const isExpanded = expandedFiles.has(diff.file)
        return (
          <View key={diff.file} className="overflow-hidden rounded-[18px] border border-border bg-surface">
            <Pressable
              className="flex-row items-center justify-between gap-3 border-b border-border px-3 py-2.5"
              onPress={() => toggle(diff.file)}
            >
              <Text className="flex-1 text-sm font-semibold text-ink" numberOfLines={2}>
                {diff.file}
              </Text>
              <View className="flex-row items-center gap-2">
                <View className={`rounded-full border px-2 py-0.5 ${status.style}`}>
                  <Text className="text-[10px] font-semibold">{status.label}</Text>
                </View>
                <Text className="text-xs text-soft">
                  +{diff.additions} / -{diff.deletions}
                </Text>
              </View>
            </Pressable>
            {isExpanded ? (
              <ScrollView className="max-h-72" nestedScrollEnabled style={{ flexGrow: 0 }}>
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator
                  className="px-3 py-2.5"
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={{ alignSelf: "flex-start" }}
                >
                  <View className="gap-1">
                    {renderLines(diff.before, diff.after).map((line, index) => (
                      <Text
                        key={`${diff.file}-${index}`}
                        selectable
                        className={`font-mono text-xs leading-5 ${line.kind === "add" ? "text-emerald-300" : line.kind === "remove" ? "text-rose-300" : "text-muted"}`}
                      >
                        {line.text || " "}
                      </Text>
                    ))}
                  </View>
                </ScrollView>
              </ScrollView>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}
