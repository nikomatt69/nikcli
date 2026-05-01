import { useCallback, useMemo, useRef, useState } from "react"
import { useEffect } from "react"
import { Animated, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import * as Clipboard from "expo-clipboard"
import { ChevronDown, ChevronUp, Copy, Expand } from "lucide-react-native"
import type { DiffHunk, DiffLine, ParsedFileDiff } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"

interface LineData {
  type: "add" | "remove" | "context"
  text: string
  oldLine: number | undefined
  newLine: number | undefined
  hunkIndex: number
  lineIndex: number
}

interface GitLineDiffEditorProps {
  diffs: ParsedFileDiff[]
  activeFileIndex?: number
  onFileSelect?: (index: number) => void
  showLineNumbers?: boolean
  maxHeight?: number
}

function parseDiffToLines(diff: ParsedFileDiff): LineData[] {
  const lines: LineData[] = []
  let oldLine = diff.hunks[0]?.header.oldStart ?? 1
  let newLine = diff.hunks[0]?.header.newStart ?? 1

  diff.hunks.forEach((hunk, hunkIndex) => {
    lines.push({
      type: "context",
      text: `@@ -${hunk.header.oldStart},${hunk.header.oldLines} +${hunk.header.newStart},${hunk.header.newLines} @@`,
      oldLine: undefined,
      newLine: undefined,
      hunkIndex,
      lineIndex: -1,
    })

    hunk.lines.forEach((line, lineIndex) => {
      lines.push({
        type: line.type,
        text: line.text,
        oldLine: line.type !== "add" ? oldLine++ : undefined,
        newLine: line.type !== "remove" ? newLine++ : undefined,
        hunkIndex,
        lineIndex,
      })
    })
  })

  return lines
}

function LineView({
  line,
  showLineNumbers,
  isDark,
  palette,
}: {
  line: LineData
  showLineNumbers: boolean
  isDark: boolean
  palette: any
}) {
  const isHeader = line.lineIndex === -1
  const isAdd = line.type === "add"
  const isRemove = line.type === "remove"

  const backgroundColor = isHeader
    ? isDark
      ? "rgba(255,255,255,0.05)"
      : "rgba(0,0,0,0.03)"
    : isAdd
      ? isDark
        ? "rgba(34,197,94,0.15)"
        : "rgba(34,197,94,0.08)"
      : isRemove
        ? isDark
          ? "rgba(239,68,68,0.15)"
          : "rgba(239,68,68,0.08)"
        : "transparent"

  const textColor = isHeader
    ? palette.accentLight
    : isAdd
      ? isDark
        ? "#4ade80"
        : "#16a34a"
      : isRemove
        ? isDark
          ? "#f87171"
          : "#dc2626"
        : palette.ink

  const prefix = isHeader ? "" : isAdd ? "+" : isRemove ? "-" : " "

  return (
    <View
      style={{
        flexDirection: "row",
        minHeight: 20,
        backgroundColor,
      }}
    >
      {showLineNumbers && (
        <View style={styles.lineNumbers}>
          <Text style={[styles.lineNumber, { color: palette.muted }]}>{line.oldLine ?? ""}</Text>
          <Text style={[styles.lineNumber, { color: palette.muted }]}>{line.newLine ?? ""}</Text>
        </View>
      )}
      <View style={[styles.lineContent, { borderLeftWidth: showLineNumbers ? 1 : 0, borderLeftColor: palette.border }]}>
        <Text
          style={[
            styles.lineText,
            {
              color: textColor,
              fontWeight: isHeader ? "600" : "400",
            },
          ]}
          selectable
        >
          {prefix} {line.text}
        </Text>
      </View>
    </View>
  )
}

export function GitLineDiffEditor({
  diffs,
  activeFileIndex,
  onFileSelect,
  showLineNumbers = true,
  maxHeight = 400,
}: GitLineDiffEditorProps) {
  const { palette, isDark } = useAppTheme()
  const flatListRef = useRef<FlatList>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState(activeFileIndex ?? 0)
  const [copied, setCopied] = useState(false)
  const [hunkExpanded, setHunkExpanded] = useState<Record<string, boolean>>({})

  const currentDiff = diffs[selectedFileIndex]

  useEffect(() => {
    if (activeFileIndex == null || activeFileIndex === selectedFileIndex) return
    if (!diffs[activeFileIndex]) return
    setSelectedFileIndex(activeFileIndex)
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [activeFileIndex, diffs, selectedFileIndex])

  const allLines = useMemo(() => {
    if (!currentDiff) return []
    return parseDiffToLines(currentDiff).map((line, index) => ({ ...line, id: `${selectedFileIndex}-${index}` }))
  }, [currentDiff, selectedFileIndex])

  const stats = useMemo(() => {
    if (!currentDiff) return { additions: 0, deletions: 0, files: 0 }
    return {
      additions: diffs.reduce((sum, d) => sum + (d.additions ?? 0), 0),
      deletions: diffs.reduce((sum, d) => sum + (d.deletions ?? 0), 0),
      files: diffs.length,
    }
  }, [diffs])

  const handleFileSelect = useCallback(
    (index: number) => {
      setSelectedFileIndex(index)
      onFileSelect?.(index)
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
    },
    [onFileSelect],
  )

  const handleCopy = useCallback(async () => {
    if (!currentDiff) return
    const text = currentDiff.hunks
      .map((hunk) =>
        hunk.lines
          .map((line) => `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} ${line.text}`)
          .join("\n"),
      )
      .join("\n\n")
    await Clipboard.setStringAsync(text)
    setCopied(true)
    void triggerHaptic("selection")
    setTimeout(() => setCopied(false), 2000)
  }, [currentDiff])

  const renderLine = useCallback(
    ({ item }: { item: LineData & { id: string } }) => (
      <LineView line={item} showLineNumbers={showLineNumbers} isDark={isDark} palette={palette} />
    ),
    [showLineNumbers, isDark, palette],
  )

  const keyExtractor = useCallback((item: LineData & { id: string }) => item.id, [])

  if (!currentDiff) {
    return (
      <View style={{ padding: 24, alignItems: "center" }}>
        <Text style={{ fontSize: 14, color: palette.soft }}>No diff available</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      {/* File tabs */}
      <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexWrap: "wrap" }}>
        {diffs.map((diff, index) => (
          <Pressable
            key={`${diff.stage ?? "worktree"}:${diff.file}:${index}`}
            onPress={() => handleFileSelect(index)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor:
                index === selectedFileIndex
                  ? isDark
                    ? "rgba(14,165,233,0.2)"
                    : "rgba(14,165,233,0.1)"
                  : isDark
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(0,0,0,0.04)",
              borderWidth: 1,
              borderColor:
                index === selectedFileIndex
                  ? isDark
                    ? "rgba(14,165,233,0.4)"
                    : "rgba(14,165,233,0.2)"
                  : palette.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {diff.stage ? (
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: diff.stage === "staged" ? "#22c55e" : "#f59e0b",
                  }}
                />
              ) : null}
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: index === selectedFileIndex ? palette.accentLight : palette.ink,
                  maxWidth: 130,
                }}
                numberOfLines={1}
              >
                {diff.file.split("/").pop()}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Stats bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
        }}
      >
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: "#22c55e" }}>+{stats.additions}</Text>
          <Text style={{ fontSize: 11, fontWeight: "600", color: "#ef4444" }}>-{stats.deletions}</Text>
          <Text style={{ fontSize: 11, fontWeight: "600", color: palette.soft }}>{diffs.length} files</Text>
          {currentDiff.stage ? (
            <Text
              style={{ fontSize: 11, fontWeight: "700", color: currentDiff.stage === "staged" ? "#22c55e" : "#f59e0b" }}
            >
              {currentDiff.stage === "staged" ? "staged" : "worktree"}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={handleCopy}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: copied ? "rgba(34,197,94,0.15)" : "transparent",
          }}
        >
          <Copy size={12} color={copied ? "#22c55e" : palette.muted} />
          <Text style={{ fontSize: 10, fontWeight: "600", color: copied ? "#22c55e" : palette.muted }}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>

      {/* Diff content */}
      <FlatList
        ref={flatListRef}
        data={allLines}
        renderItem={renderLine}
        keyExtractor={keyExtractor}
        style={{ maxHeight }}
        showsVerticalScrollIndicator={true}
        scrollEventThrottle={16}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  lineNumbers: {
    width: 60,
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingRight: 8,
  },
  lineNumber: {
    width: 26,
    fontSize: 10,
    fontFamily: "Menlo",
    textAlign: "right",
  },
  lineContent: {
    flex: 1,
    paddingLeft: 8,
    paddingRight: 12,
  },
  lineText: {
    fontSize: 11,
    fontFamily: "Menlo",
    lineHeight: 20,
  },
})
