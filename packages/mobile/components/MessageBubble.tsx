import { LayoutAnimation, Pressable, Text, View } from "react-native"
import { useMemo, useState } from "react"
import Markdown from "react-native-markdown-display"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { AssistantMessage, FileDiff, MessageWithParts, PatchPart, ReasoningPart, TextPart, ToolPart } from "@/lib/types"
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
    setShowReasoning((v) => !v)
  }

  return (
    <View className={`mb-4 ${isUser ? "items-end" : "items-start"}`}>
      <View
        className={`max-w-[94%] rounded-[28px] border px-4 py-4 ${isUser ? "border-accent/40 bg-user-bubble" : "border-border bg-assistant-bubble"}`}
        style={{ shadowColor: "#020617", shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } }}
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
          <View className="mt-3 rounded-2xl border border-border bg-background/50 px-3 py-3">
            <Pressable onPress={toggleReasoning} className="flex-row items-center gap-2">
              <Ionicons name={showReasoning ? "chevron-down" : "chevron-forward"} size={12} color="#7dd3fc" />
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
          <View className="mt-3 rounded-2xl border border-border bg-background/50 px-3 py-3">
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
            <Text className="mt-2 text-sm text-soft">{patch.files.join("\n")}</Text>
            {props.diffs?.length ? <DiffViewer diffs={props.diffs} /> : null}
          </View>
        ) : null}

        {assistantInfo && (cost > 0 || tokens > 0) ? (
          <Text className="mt-2 text-[10px] text-muted">
            ${cost.toFixed(5)} · {tokens.toLocaleString()} tok
          </Text>
        ) : null}
        <Text className="mt-1 text-[10px] text-muted">{relativeTime(props.message.info.time.created)}</Text>

        {props.isActive && (props.onCopy || props.onFork) ? (
          <View className="mt-3 flex-row gap-2 border-t border-border pt-3">
            {props.onCopy ? (
              <Pressable
                onPress={props.onCopy}
                className="flex-row items-center gap-1 rounded-full border border-border bg-background/70 px-3 py-2"
              >
                <Ionicons name="copy-outline" size={13} color="#7dd3fc" />
                <Text className="text-[11px] font-semibold text-ink">Copy</Text>
              </Pressable>
            ) : null}
            {props.onFork ? (
              <Pressable
                onPress={props.onFork}
                className="flex-row items-center gap-1 rounded-full border border-border bg-background/70 px-3 py-2"
              >
                <Ionicons name="git-branch-outline" size={13} color="#7dd3fc" />
                <Text className="text-[11px] font-semibold text-ink">Fork</Text>
              </Pressable>
            ) : null}
            {props.onDismiss ? (
              <Pressable
                onPress={props.onDismiss}
                className="flex-row items-center gap-1 rounded-full border border-border bg-background/70 px-3 py-2"
              >
                <Ionicons name="close-outline" size={13} color="#4a6a85" />
                <Text className="text-[11px] font-semibold text-soft">Dismiss</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}
