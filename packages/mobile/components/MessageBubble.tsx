import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ChevronRight, Copy, GitBranch, X, type LucideIcon } from "lucide-react-native"
import * as Clipboard from "expo-clipboard"
import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display"
import { Swipeable } from "react-native-gesture-handler"
import type {
  AssistantMessage,
  FileDiff,
  MessageWithParts,
  PatchPart,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@/lib/types"
import { relativeTime } from "@/lib/text-utils"
import { highlightCode } from "@/lib/syntax"
import { ToolCallView } from "@/components/ToolCallView"
import { DiffViewer } from "@/components/DiffViewer"
import { triggerHaptic } from "@/lib/haptics"
import { useUIStore } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"

function latestText(parts: MessageWithParts["parts"]) {
  return parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
}

function reasoningParts(parts: MessageWithParts["parts"]) {
  return parts.filter((part): part is ReasoningPart => part.type === "reasoning")
}

function patchPart(parts: MessageWithParts["parts"]) {
  return parts.find((part): part is PatchPart => part.type === "patch")
}

function toolParts(parts: MessageWithParts["parts"]) {
  return parts.filter((part): part is ToolPart => part.type === "tool")
}

function renderPathPreview(files: string[]) {
  return files.map((file, index) => (
    <View
      key={`${file}-${index}`}
      className="overflow-hidden rounded-[12px] border border-border/70 bg-surface px-2.5 py-2"
    >
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ alignSelf: "flex-start" }}
      >
        <Text selectable className="font-mono text-xs leading-5 text-soft">
          {file || "Unknown file"}
        </Text>
      </ScrollView>
    </View>
  ))
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function trimmedCodeContent(node: ASTNode) {
  if (typeof node.content !== "string") return ""
  return node.content.endsWith("\n") ? node.content.slice(0, -1) : node.content
}

function getLanguage(node: ASTNode): string {
  const info = (node.sourceType as string | undefined)?.trim()
  return info?.split(/\s+/)[0]?.toLowerCase() || "code"
}


function ScrollableCodeBlock(props: { node: ASTNode; textStyle: any; backgroundColor: string; borderColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const { palette } = useAppTheme()
  const language = getLanguage(props.node)
  const code = trimmedCodeContent(props.node)
  const lineCount = code.split("\n").length
  const isLong = lineCount > 10
  const lineHighlights = useMemo(() => code.split("\n").map((line) => highlightCode(line)), [code])
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  async function handleCopy() {
    await Clipboard.setStringAsync(code)
    setCopied(true)
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View
      key={props.node.key}
      className="mt-1 mb-0 overflow-hidden rounded-2xl border"
      style={{ backgroundColor: palette.codeBlockBackground, borderColor: palette.border }}
    >
      <View
        className="flex-row items-center justify-between border-b px-4 py-2.5"
        style={{ backgroundColor: `${palette.codeBlockBackground}dd`, borderBottomColor: palette.border }}
      >
        <View className="flex-row items-center gap-2">
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#ff5f57" }} />
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#ffbd2e" }} />
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#28c840" }} />
        </View>
        <Text className="text-[10px] font-bold uppercase tracking-wider" style={{ color: palette.accentLight }}>
          {language}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className="text-[9px]" style={{ color: palette.muted }}>
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </Text>
          <Pressable
            onPress={handleCopy}
            hitSlop={8}
            className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ backgroundColor: copied ? `${palette.success}30` : `${palette.border}40` }}
          >
            <Copy size={10} color={copied ? palette.success : palette.muted} strokeWidth={2} />
            <Text className="text-[10px] font-semibold" style={{ color: copied ? palette.success : palette.muted }}>
              {copied ? "Copied" : "Copy"}
            </Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        nestedScrollEnabled
        horizontal
        showsHorizontalScrollIndicator={true}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: expanded ? 800 : 400 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 }}
      >
        <View>
          {lineHighlights.map((lineHighlighted, lineIndex) => {
            return (
              <Text key={lineIndex} selectable className="text-[11px] leading-[18px]" style={{ fontFamily: "Menlo" }}>
                {lineHighlighted.map((seg, i) => (
                  <Text key={i} style={{ color: seg.color }}>
                    {seg.text}
                  </Text>
                ))}
                {"\n"}
              </Text>
            )
          })}
        </View>
      </ScrollView>
      {isLong && (
        <Pressable
          onPress={() => setExpanded(!expanded)}
          className="border-t py-2.5"
          style={{ backgroundColor: `${palette.codeBlockBackground}dd`, borderTopColor: palette.border }}
        >
          <Text className="text-center text-[11px] font-semibold" style={{ color: palette.accentLight }}>
            {expanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

function ActionChip(props: { label: string; onPress(): void; icon: LucideIcon; muted?: boolean }) {
  const Icon = props.icon
  const { palette, isDark } = useAppTheme()

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 18,
        backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
        paddingHorizontal: 14,
        paddingVertical: 8,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <Icon
        size={14}
        color={
          props.muted ? (isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)") : isDark ? "#FFFFFF" : palette.accent
        }
        strokeWidth={2}
      />
      <Text
        className="text-[12px] font-medium"
        style={{
          color: props.muted
            ? isDark
              ? "rgba(255,255,255,0.4)"
              : "rgba(0,0,0,0.4)"
            : isDark
              ? "#FFFFFF"
              : palette.ink,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  )
}

export function MessageBubble(props: {
  message: MessageWithParts
  diffs?: FileDiff[]
  diffLoaded?: boolean
  diffLoading?: boolean
  onLoadDiff?(messageID: string): void
  onCopy?: () => void
  onFork?: () => void
  onDismiss?: () => void
  onActivate?(): void
  isActive?: boolean
}) {
  const { palette, isDark } = useAppTheme()
  const gestures = useUIStore((state) => state.gestures)
  const [showReasoning, setShowReasoning] = useState(false)
  const reasoningRotation = useRef(new Animated.Value(0)).current
  const text = useMemo(() => latestText(props.message.parts), [props.message.parts])
  const reasoning = useMemo(() => reasoningParts(props.message.parts), [props.message.parts])
  const patch = patchPart(props.message.parts)
  const tools = toolParts(props.message.parts)
  const isUser = props.message.info.role === "user"

  const assistantInfo = !isUser ? (props.message.info as AssistantMessage) : null
  const assistantError = assistantInfo?.error?.data?.message
  const cost = assistantInfo?.cost ?? 0
  const tokens = assistantInfo ? assistantInfo.tokens.input + assistantInfo.tokens.output : 0
  const reasoningText = useMemo(
    () =>
      reasoning
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n\n"),
    [reasoning],
  )
  const wordCount = reasoningText ? words(reasoningText) : 0
  const reasoningVisible = reasoning.length > 0
  const reasoningExpanded = showReasoning || wordCount === 0
  const markdownRules = useMemo<RenderRules>(
    () => ({
      code_block: (node, _children, _parent, styles, inheritedStyles = {}) => (
        <ScrollableCodeBlock
          node={node}
          textStyle={[inheritedStyles, styles.code_block]}
          backgroundColor={palette.codeBackground}
          borderColor={palette.border}
        />
      ),
      fence: (node, _children, _parent, styles, inheritedStyles = {}) => (
        <ScrollableCodeBlock
          node={node}
          textStyle={[inheritedStyles, styles.fence]}
          backgroundColor={palette.codeBackground}
          borderColor={palette.border}
        />
      ),
    }),
    [palette.border, palette.codeBackground],
  )
  const summaryLine = useMemo(() => {
    const items = [] as string[]
    if (tools.length) items.push(`${tools.length} tool${tools.length === 1 ? "" : "s"}`)
    if (patch?.files.length) items.push(`${patch.files.length} file${patch.files.length === 1 ? "" : "s"}`)
    if (reasoning.length) items.push(`reasoning`)
    return items.join(" · ")
  }, [patch?.files.length, reasoning.length, tools.length])
  const timeLabel = relativeTime(props.message.info.time.created)

  function toggleReasoning() {
    const next = !showReasoning
    Animated.timing(reasoningRotation, {
      toValue: next ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start()
    LayoutAnimation.configureNext({
      duration: 240,
      create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity, duration: 200 },
      update: { type: LayoutAnimation.Types.spring, springDamping: 0.8, duration: 240 },
      delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity, duration: 130 },
    })
    setShowReasoning(next)
  }

  const bubble = (
    <Pressable
      onLongPress={() => {
        if (!gestures.bubbleLongPressActions) return
        props.onActivate?.()
        void triggerHaptic("selection")
      }}
      delayLongPress={180}
    >
      <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
        <View
          className={`max-w-[95%] min-w-0 overflow-hidden rounded-[28px] border ${isUser ? "border-accent/35 bg-user-bubble" : "border-border bg-assistant-bubble"}`}
          style={{
            shadowColor: palette.shadow,
            shadowOpacity: isDark ? 0.18 : 0.1,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 10 },
          }}
        >
          <View className="min-w-0 flex-row items-start justify-between gap-3 px-3.5 py-3">
            <View className="min-w-0 flex-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <View
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: isUser
                      ? isDark
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(14,165,233,0.18)"
                      : isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(193,208,223,0.72)",
                    backgroundColor: isUser
                      ? isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(14,165,233,0.10)"
                      : isDark
                        ? "rgba(255,255,255,0.04)"
                        : "rgba(241,246,251,0.78)",
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <Text className="text-[10px] font-semibold uppercase tracking-[1.4px] text-accent-light">
                    {isUser ? "You" : "Nikcli"}
                  </Text>
                </View>
                {summaryLine ? <Text className="text-[11px] leading-4 text-soft">{summaryLine}</Text> : null}
              </View>
            </View>
            <View className="items-end gap-1">
              {assistantInfo && (cost > 0 || tokens > 0) ? (
                <Text className="text-[10px] text-muted" style={{ fontVariant: ["tabular-nums"] }}>
                  {cost > 0 ? `$${cost < 0.001 ? cost.toFixed(5) : cost.toFixed(4)}` : null}{cost > 0 && tokens > 0 ? " · " : null}{tokens > 0 ? `${tokens.toLocaleString()} tok` : null}
                </Text>
              ) : null}
              <Text className="text-[10px] text-muted">{timeLabel}</Text>
            </View>
          </View>

          {text || assistantError ? (
            <View className="min-w-0 border-t border-border/80 px-3.5 pt-3 pb-2">
              {text ? (
                <Markdown
                  rules={markdownRules}
                  style={{
                    body: { color: palette.ink, fontSize: 14, lineHeight: 22, marginBottom: 0 },
                    paragraph: { marginTop: 0, marginBottom: 8 },
                    heading1: { color: palette.ink, fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 8 },
                    heading2: { color: palette.ink, fontSize: 16, fontWeight: "700", marginTop: 10, marginBottom: 6 },
                    heading3: { color: palette.ink, fontSize: 14, fontWeight: "700", marginTop: 8, marginBottom: 4 },
                    heading4: { color: palette.ink, fontSize: 12, fontWeight: "600", marginTop: 4, marginBottom: 3 },
                    heading5: { color: palette.ink, fontSize: 11, fontWeight: "600", marginTop: 4, marginBottom: 2 },
                    heading6: { color: palette.muted, fontSize: 10, fontWeight: "600", marginTop: 4, marginBottom: 2 },
                    strong: { fontWeight: "700" },
                    em: { fontStyle: "italic" },
                    s: { textDecorationLine: "line-through", color: palette.muted },
                    hr: { backgroundColor: palette.border, height: StyleSheet.hairlineWidth, marginVertical: 12 },
                    table: {
                      borderWidth: 1,
                      borderColor: palette.border,
                      borderRadius: 10,
                      marginVertical: 10,
                      overflow: "hidden",
                    },
                    thead: { backgroundColor: palette.surface },
                    th: {
                      color: palette.ink,
                      fontWeight: "600",
                      fontSize: 11,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderRightWidth: 1,
                      borderRightColor: palette.border,
                      borderBottomWidth: 2,
                      borderBottomColor: palette.border,
                    },
                    tr: {
                      borderBottomWidth: 1,
                      borderBottomColor: palette.border,
                    },
                    td: {
                      color: palette.soft,
                      fontSize: 11,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRightWidth: 1,
                      borderRightColor: palette.border,
                    },
                    bullet_list: { marginVertical: 4 },
                    ordered_list: { marginVertical: 4 },
                    list_item: { marginBottom: 5 },
                    bullet_list_icon: { color: palette.accentLight, marginRight: 6 },
                    bullet_list_content: { flex: undefined, flexGrow: 1, flexShrink: 1 },
                    ordered_list_icon: { color: palette.accentLight, marginRight: 6 },
                    ordered_list_content: { flex: undefined, flexGrow: 1, flexShrink: 1 },
                    code_inline: {
                      color: palette.accentLight,
                      backgroundColor: palette.codeBackground,
                      borderRadius: 14,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      fontFamily: "Menlo",
                      fontSize: 11,
                    },
                    code_block: {
                      color: palette.codeText,
                      fontSize: 11,
                      lineHeight: 16,
                      fontFamily: "Menlo",
                      includeFontPadding: false,
                    },
                    fence: {
                      color: palette.codeText,
                      fontSize: 11,
                      lineHeight: 16,
                      fontFamily: "Menlo",
                      includeFontPadding: false,
                    },
                    blockquote: {
                      borderLeftWidth: 3,
                      borderLeftColor: palette.accent,
                      paddingLeft: 12,
                      paddingVertical: 4,
                      marginVertical: 8,
                      backgroundColor: `${palette.accent}10`,
                      borderRadius: 4,
                    },
                    link: { color: palette.accentLight, textDecorationLine: "underline" },
                  }}
                >
                  {text}
                </Markdown>
              ) : null}

              {assistantError ? (
                <View className="rounded-[16px] border border-danger/25 bg-danger/10 px-3 py-2.5">
                  <Text selectable className="text-sm leading-5" style={{ color: palette.danger }}>
                    {assistantError}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {reasoningVisible ? (
            <View className="border-t border-border/80 px-3.5 py-3">
              <View className="rounded-[20px] border border-border bg-background/55 px-3 py-3">
                <Pressable onPress={toggleReasoning} className="flex-row items-center gap-2">
                  <Animated.View
                    style={{
                      transform: [
                        {
                          rotate: reasoningRotation.interpolate({
                            inputRange: [0, 1],
                            outputRange: ["0deg", "90deg"],
                          }),
                        },
                      ],
                    }}
                  >
                    <ChevronRight size={13} color={palette.accentLight} strokeWidth={2.1} />
                  </Animated.View>
                  <Text className="flex-1 text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-light">
                    {wordCount > 0 ? `Reasoning · ${wordCount.toLocaleString()} words` : "Reasoning"}
                  </Text>
                </Pressable>
                {reasoningExpanded ? (
                  <Text selectable className="mt-2 text-sm leading-5 text-soft">
                    {reasoningText ||
                      "Reasoning metadata was returned, but no visible reasoning text was captured for this step."}
                  </Text>
                ) : (
                  <Text className="mt-2 text-sm leading-5 text-soft" numberOfLines={2}>
                    {reasoningText}
                  </Text>
                )}
              </View>
            </View>
          ) : null}

          {tools.length ? (
            <View className="border-t border-border/80 px-3.5 py-3">
              <View className="gap-2">
                {tools.map((part) => (
                  <ToolCallView key={part.id} part={part} />
                ))}
              </View>
            </View>
          ) : null}

          {patch ? (
            <View className="border-t border-border/80 px-3.5 py-3">
              <View className="rounded-[20px] border border-border bg-background/55 px-3 py-3">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-sm font-semibold text-ink">Patch preview</Text>
                  {!props.diffLoaded ? (
                    <Pressable onPress={() => props.onLoadDiff?.(props.message.info.id)}>
                      <Text className="text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-light">
                        {props.diffLoading ? "Loading..." : "Load diff"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <ScrollView className="mt-2 max-h-28" nestedScrollEnabled style={{ flexGrow: 0 }}>
                  <View className="min-w-0 gap-1">{renderPathPreview(patch.files)}</View>
                </ScrollView>
                {props.diffLoaded ? (
                  props.diffs?.length ? (
                    <DiffViewer diffs={props.diffs} />
                  ) : (
                    <View className="mt-3 rounded-[14px] border border-border/70 bg-surface px-3 py-2.5">
                      <Text className="text-sm leading-5 text-soft">
                        No structured diff is available for this patch step.
                      </Text>
                    </View>
                  )
                ) : null}
              </View>
            </View>
          ) : null}

          {props.isActive && (props.onCopy || props.onFork || props.onDismiss) ? (
            <View className="flex-row flex-wrap gap-2 border-t border-border/80 px-3.5 py-3">
              {props.onCopy ? <ActionChip label="Copy" onPress={props.onCopy} icon={Copy} /> : null}
              {props.onFork ? <ActionChip label="Reuse" onPress={props.onFork} icon={GitBranch} /> : null}
              {props.onDismiss ? <ActionChip label="Dismiss" onPress={props.onDismiss} icon={X} muted /> : null}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )

  if (!gestures.bubbleSwipeActions || (!props.onCopy && !props.onFork && !props.onDismiss)) {
    return bubble
  }

  return (
    <Swipeable
      overshootRight={false}
      renderRightActions={() => (
        <View className="mb-3 ml-2 flex-row items-center gap-2 self-stretch">
          {props.onCopy ? <ActionChip label="Copy" onPress={props.onCopy} icon={Copy} /> : null}
          {props.onFork ? <ActionChip label="Reuse" onPress={props.onFork} icon={GitBranch} /> : null}
          {props.onDismiss ? <ActionChip label="Hide" onPress={props.onDismiss} icon={X} muted /> : null}
        </View>
      )}
      onSwipeableWillOpen={() => {
        props.onActivate?.()
        void triggerHaptic("selection")
      }}
    >
      {bubble}
    </Swipeable>
  )
}
