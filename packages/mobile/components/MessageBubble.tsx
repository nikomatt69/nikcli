import { useMemo, useState } from "react"
import { LayoutAnimation, Pressable, Text, View } from "react-native"
import { ChevronDown, ChevronRight, Copy, GitBranch, X, type LucideIcon } from "lucide-react-native"
import Markdown from "react-native-markdown-display"
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

function latestText(parts: MessageWithParts["parts"]) {
  return parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
}

function reasoningPart(parts: MessageWithParts["parts"]) {
  return parts.find((part): part is ReasoningPart => part.type === "reasoning")
}

function patchPart(parts: MessageWithParts["parts"]) {
  return parts.find((part): part is PatchPart => part.type === "patch")
}

function toolParts(parts: MessageWithParts["parts"]) {
  return parts.filter((part): part is ToolPart => part.type === "tool")
}

function patchFileList(files: string[]): string {
  return files.map((file) => file || "Unknown file").join("\n")
}

function ActionChip(props: { label: string; onPress(): void; icon: LucideIcon; muted?: boolean }) {
  const Icon = props.icon

  return (
    <Pressable
      onPress={props.onPress}
      className="flex-row items-center gap-1 rounded-full border border-border bg-background/70 px-3 py-2"
    >
      <Icon size={13} color={props.muted ? "#6f90ac" : "#7dd3fc"} strokeWidth={2.1} />
      <Text className={`text-[11px] font-semibold ${props.muted ? "text-soft" : "text-ink"}`}>{props.label}</Text>
    </Pressable>
  )
}

export function MessageBubble(props: {
  message: MessageWithParts
  diffs?: FileDiff[]
  onLoadDiff?(messageID: string): void
  onCopy?: () => void
  onFork?: () => void
  onDismiss?: () => void
  isActive?: boolean
}) {
  const [showReasoning, setShowReasoning] = useState(false)
  const text = useMemo(() => latestText(props.message.parts), [props.message.parts])
  const reasoning = reasoningPart(props.message.parts)
  const patch = patchPart(props.message.parts)
  const tools = toolParts(props.message.parts)
  const isUser = props.message.info.role === "user"

  const assistantInfo = !isUser ? (props.message.info as AssistantMessage) : null
  const cost = assistantInfo?.cost ?? 0
  const tokens = assistantInfo ? assistantInfo.tokens.input + assistantInfo.tokens.output : 0
  const wordCount = reasoning ? Math.ceil(reasoning.text.length / 5) : 0

  function toggleReasoning() {
    LayoutAnimation.easeInEaseOut()
    setShowReasoning((value) => !value)
  }

  return (
    <View className={`mb-4 ${isUser ? "items-end" : "items-start"}`}>
      <View
        className={`max-w-[94%] rounded-[30px] border px-4 py-4 ${isUser ? "border-accent/40 bg-user-bubble" : "border-border bg-assistant-bubble"}`}
        style={{
          shadowColor: "#020617",
          shadowOpacity: 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
          {isUser ? "You" : "Nikcli"}
        </Text>
        {text ? (
          <Markdown
            style={{
              body: { color: "#e6eef8", fontSize: 15, lineHeight: 23 },
              paragraph: { marginTop: 0, marginBottom: 10 },
              code_inline: { color: "#7dd3fc", backgroundColor: "#071321" },
              code_block: { color: "#d8e5f2", backgroundColor: "#071321", padding: 12, borderRadius: 14 },
            }}
          >
            {text}
          </Markdown>
        ) : null}

        {reasoning ? (
          <View className="mt-3 rounded-[22px] border border-border bg-background/55 px-3 py-3">
            <Pressable onPress={toggleReasoning} className="flex-row items-center gap-2">
              {showReasoning ? (
                <ChevronDown size={13} color="#7dd3fc" strokeWidth={2.1} />
              ) : (
                <ChevronRight size={13} color="#7dd3fc" strokeWidth={2.1} />
              )}
              <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
                Reasoning ({wordCount.toLocaleString()} words)
              </Text>
            </Pressable>
            {showReasoning ? <Text className="mt-2 text-sm italic leading-6 text-soft">{reasoning.text}</Text> : null}
          </View>
        ) : null}

        {tools.map((part) => (
          <ToolCallView key={part.id} part={part} />
        ))}

        {patch ? (
          <View className="mt-3 rounded-[22px] border border-border bg-background/55 px-3 py-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-ink">Patch preview</Text>
              {props.diffs?.length ? null : (
                <Pressable onPress={() => props.onLoadDiff?.(props.message.info.id)}>
                  <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
                    Load diff
                  </Text>
                </Pressable>
              )}
            </View>
            <Text className="mt-2 text-sm text-soft">{patchFileList(patch.files)}</Text>
            {props.diffs?.length ? <DiffViewer diffs={props.diffs} /> : null}
          </View>
        ) : null}

        {assistantInfo && (cost > 0 || tokens > 0) ? (
          <Text className="mt-2 text-[10px] text-muted">
            ${cost.toFixed(5)} · {tokens.toLocaleString()} tok
          </Text>
        ) : null}
        <Text className="mt-1 text-[10px] text-muted">{relativeTime(props.message.info.time.created)}</Text>

        {props.isActive && (props.onCopy || props.onFork || props.onDismiss) ? (
          <View className="mt-3 flex-row flex-wrap gap-2 border-t border-border pt-3">
            {props.onCopy ? <ActionChip label="Copy" onPress={props.onCopy} icon={Copy} /> : null}
            {props.onFork ? <ActionChip label="Fork" onPress={props.onFork} icon={GitBranch} /> : null}
            {props.onDismiss ? <ActionChip label="Dismiss" onPress={props.onDismiss} icon={X} muted /> : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}
