import { useState } from "react"
import { LayoutAnimation, Pressable, ScrollView, Text, View } from "react-native"
import type { FileDiff } from "@/lib/types"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

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

function fileStatus(diff: FileDiff, palette: ReturnType<typeof useAppTheme>["palette"]) {
  if (diff.before === "") {
    return { label: "added", color: palette.success }
  }
  if (diff.after === "") {
    return { label: "deleted", color: palette.danger }
  }
  return { label: "modified", color: palette.warn }
}

export function DiffViewer(props: { diffs: FileDiff[] }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const { palette } = useAppTheme()

  function toggle(file: string) {
    LayoutAnimation.configureNext({
      duration: 240,
      create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity, duration: 200 },
      update: { type: LayoutAnimation.Types.spring, springDamping: 0.8, duration: 240 },
      delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity, duration: 130 },
    })
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      {props.diffs.map((diff, diffIndex) => {
        const status = fileStatus(diff, palette)
        const isExpanded = expandedFiles.has(diff.file)
        return (
          <View
            key={`${diff.file}-${diffIndex}`}
            style={{
              overflow: "hidden",
              borderRadius: 18,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: hexToRgba(palette.ink, 0.08),
              backgroundColor: palette.surface,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
              accessibilityLabel={`${diff.file} ${status.label}`}
              hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
              onPress={() => toggle(diff.file)}
              style={{
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottomWidth: isExpanded ? 1 : 0,
                borderBottomColor: hexToRgba(palette.ink, 0.08),
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <Text
                selectable
                allowFontScaling={false}
                numberOfLines={2}
                style={{ flex: 1, color: palette.ink, ...typeStyle(14, { weight: "600" }) }}
              >
                {diff.file}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: hexToRgba(status.color, 0.28),
                    backgroundColor: hexToRgba(status.color, 0.12),
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }}
                >
                  <Text
                    allowFontScaling={false}
                    style={{ color: status.color, fontSize: 10, fontWeight: "700", letterSpacing: 0.3 }}
                  >
                    {status.label}
                  </Text>
                </View>
                <Text
                  allowFontScaling={false}
                  style={{
                    color: palette.soft,
                    fontSize: 12,
                    fontWeight: "600",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  <Text style={{ color: palette.success }}>+{diff.additions}</Text>
                  {" / "}
                  <Text style={{ color: palette.danger }}>-{diff.deletions}</Text>
                </Text>
              </View>
            </Pressable>
            {isExpanded ? (
              <ScrollView
                style={{ maxHeight: 288, flexGrow: 0 }}
                nestedScrollEnabled
                bounces={false}
                scrollsToTop={false}
              >
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  bounces={false}
                  scrollsToTop={false}
                  showsHorizontalScrollIndicator
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 10 }}
                >
                  <View style={{ gap: 1 }}>
                    {renderLines(diff.before, diff.after).map((line, index) => (
                      <Text
                        key={`${index}:${line.text}`}
                        selectable
                        selectionColor={palette.accent}
                        style={{
                          fontFamily: "Menlo",
                          fontSize: 12,
                          lineHeight: 20,
                          color:
                            line.kind === "add"
                              ? palette.success
                              : line.kind === "remove"
                                ? palette.danger
                                : palette.muted,
                        }}
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
