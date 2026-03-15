import { useMemo, useState } from "react"
import { LayoutAnimation, Pressable, ScrollView, Text, View } from "react-native"
import { ChevronDown, ChevronRight, Copy, GitBranch, X, type LucideIcon } from "lucide-react-native"
import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display"
import type {
  AssistantMessage,
  FileDiff,
  MessageWithParts,
  PatchPart,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@/lib/types"
import { relativeTime } from "@/lib/types"
import { ToolCallView } from "@/components/ToolCallView"
import { DiffViewer } from "@/components/DiffViewer"
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

function ScrollableCodeBlock(props: { node: ASTNode; textStyle: any; backgroundColor: string; borderColor: string }) {
  return (
    <View
      key={props.node.key}
      className="mt-2 overflow-hidden rounded-[14px] border"
      style={{ backgroundColor: props.backgroundColor, borderColor: props.borderColor }}
    >
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={{ flexGrow: 0, maxHeight: 220 }}
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 9 }}
      >
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ alignSelf: "flex-start" }}
        >
          <Text selectable style={props.textStyle as any}>
            {trimmedCodeContent(props.node)}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  )
}

function ActionChip(props: { label: string; onPress(): void; icon: LucideIcon; muted?: boolean }) {
  const Icon = props.icon
  const { palette } = useAppTheme()

  return (
    <Pressable
      onPress={props.onPress}
      className="flex-row items-center gap-1 rounded-full border border-border bg-background/70 px-3 py-2"
    >
      <Icon size={13} color={props.muted ? palette.muted : palette.accentLight} strokeWidth={2.1} />
      <Text className={`text-[11px] font-semibold ${props.muted ? "text-soft" : "text-ink"}`}>{props.label}</Text>
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
  isActive?: boolean
}) {
  const { palette } = useAppTheme()
  const [showReasoning, setShowReasoning] = useState(false)
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
    LayoutAnimation.easeInEaseOut()
    setShowReasoning((value) => !value)
  }

  return (
    <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
      <View
        className={`max-w-[96%] min-w-0 overflow-hidden rounded-[26px] border ${isUser ? "border-accent/35 bg-user-bubble" : "border-border bg-assistant-bubble"}`}
        style={{
          shadowColor: palette.shadow,
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <View className="min-w-0 flex-row items-start justify-between gap-3 px-3.5 py-3">
          <View className="min-w-0 flex-1">
            <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
              {isUser ? "You" : "Nikcli"}
            </Text>
            {summaryLine ? <Text className="mt-1 text-xs leading-4 text-soft">{summaryLine}</Text> : null}
          </View>
          <View className="items-end gap-1">
            {assistantInfo && (cost > 0 || tokens > 0) ? (
              <Text className="text-[10px] text-muted">
                ${cost.toFixed(5)} · {tokens.toLocaleString()} tok
              </Text>
            ) : null}
            <Text className="text-[10px] text-muted">{timeLabel}</Text>
          </View>
        </View>

        {text || assistantError ? (
          <View className="min-w-0 border-t border-border/80 px-3.5 py-3">
            {text ? (
              <Markdown
                rules={markdownRules}
                style={{
                  body: { color: palette.ink, fontSize: 14, lineHeight: 22 },
                  paragraph: { marginTop: 0, marginBottom: 8 },
                  heading1: { color: palette.ink, marginTop: 4, marginBottom: 8 },
                  heading2: { color: palette.ink, marginTop: 4, marginBottom: 8 },
                  bullet_list: { marginVertical: 0 },
                  ordered_list: { marginVertical: 0 },
                  list_item: { marginBottom: 4 },
                  code_inline: {
                    color: palette.accentLight,
                    backgroundColor: "transparent",
                    borderRadius: 8,
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                  },
                  code_block: {
                    color: palette.codeText,
                    fontSize: 13,
                    lineHeight: 20,
                    includeFontPadding: false,
                  },
                  fence: {
                    color: palette.codeText,
                    fontSize: 13,
                    lineHeight: 20,
                    includeFontPadding: false,
                    backgroundColor: "transparent",
                  },
                  blockquote: {
                    borderLeftWidth: 2,
                    borderLeftColor: palette.border,
                    paddingLeft: 10,
                    color: palette.soft,
                  },
                  link: { color: palette.accentLight },
                }}
              >
                {text}
              </Markdown>
            ) : null}

            {assistantError ? (
              <View className="rounded-[16px] border border-danger/25 bg-danger/10 px-3 py-2.5">
                <Text selectable className="text-sm leading-5 text-rose-200">
                  {assistantError}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {reasoningVisible ? (
          <View className="border-t border-border/80 px-3.5 py-3">
            <View className="rounded-[18px] border border-border bg-background/55 px-3 py-2.5">
              <Pressable onPress={toggleReasoning} className="flex-row items-center gap-2">
                {reasoningExpanded ? (
                  <ChevronDown size={13} color={palette.accentLight} strokeWidth={2.1} />
                ) : (
                  <ChevronRight size={13} color={palette.accentLight} strokeWidth={2.1} />
                )}
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
            <View className="rounded-[18px] border border-border bg-background/55 px-3 py-2.5">
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
            {props.onFork ? <ActionChip label="Fork" onPress={props.onFork} icon={GitBranch} /> : null}
            {props.onDismiss ? <ActionChip label="Dismiss" onPress={props.onDismiss} icon={X} muted /> : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}
