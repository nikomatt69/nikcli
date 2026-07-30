import { memo, useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  InteractionManager,
  Keyboard,
  LayoutAnimation,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Box, ChevronRight, Copy, GitBranch, Link2, Paperclip, Play, X, type LucideIcon } from "lucide-react-native"
import * as Clipboard from "expo-clipboard"
import { Image } from "expo-image"
import { File, Paths } from "expo-file-system"
import { useVideoPlayer, VideoView } from "expo-video"
import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display"
import { Swipeable } from "react-native-gesture-handler"
import type {
  AssistantMessage,
  FileDiff,
  FilePart,
  MessageWithParts,
  PatchPart,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@/lib/types"
import { relativeTime } from "@/lib/types"
import { highlightCode } from "@/lib/syntax"
import { ToolCallView } from "@/components/ToolCallView"
import { DiffViewer } from "@/components/DiffViewer"
import { ArtifactMicroThumb, InlineArtifactCard } from "@/components/session/SessionPreviewStrip"
import { useCopiedFeedback } from "@/hooks/use-copied-feedback"
import { triggerHaptic } from "@/lib/haptics"
import { extractMessageArtifacts, kindLabel, type SessionPreview } from "@/lib/session-artifacts"
import { useUIStore } from "@/lib/store"
import { hexToRgba, useAppTheme } from "@/lib/theme"

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

function fileParts(parts: MessageWithParts["parts"]) {
  return parts.filter((part): part is FilePart => part.type === "file")
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64.replace(/\s/g, ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function videoExtension(mime: string) {
  const sub = mime.split("/")[1]?.split(";")[0]?.toLowerCase()
  if (sub === "quicktime") return "mov"
  return sub || "mp4"
}

/** AVPlayer/ExoPlayer cannot play data: URIs, so inline videos are materialized into the cache first. */
function materializeDataUri(part: FilePart): string | null {
  try {
    const base64 = part.url.slice(part.url.indexOf(",") + 1)
    const file = new File(Paths.cache, `msg-media-${part.id}.${videoExtension(part.mime)}`)
    if (!file.exists) file.write(base64ToBytes(base64))
    return file.uri
  } catch {
    return null
  }
}

function MessageVideoPlayer({ uri }: { uri: string }) {
  // Mounted only after an explicit tap, so starting playback right away is expected.
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false
    instance.play()
  })
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{
        width: "100%",
        aspectRatio: 16 / 9,
        borderRadius: 12,
        overflow: "hidden",
      }}
    />
  )
}

function MessageVideo({ part }: { part: FilePart }) {
  const { palette, isDark } = useAppTheme()
  const [uri, setUri] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [failed, setFailed] = useState(false)

  function activate() {
    if (uri || preparing || failed) return
    void triggerHaptic("selection")
    if (!part.url.startsWith("data:")) {
      setUri(part.url)
      return
    }
    setPreparing(true)
    // base64 → bytes is CPU-heavy for videos; keep it off the tap/scroll interaction path.
    void InteractionManager.runAfterInteractions(() => {
      const local = materializeDataUri(part)
      if (local) setUri(local)
      else setFailed(true)
      setPreparing(false)
    })
  }

  if (uri) {
    return (
      <View className="overflow-hidden rounded-[12px] border border-border/70" style={{ backgroundColor: "#000" }}>
        <MessageVideoPlayer uri={uri} />
        {part.filename ? (
          <Text numberOfLines={1} className="px-2.5 py-1.5 text-[11px]" style={{ color: palette.muted }}>
            {part.filename}
          </Text>
        ) : null}
      </View>
    )
  }

  return (
    <Pressable
      onPress={activate}
      disabled={preparing || failed}
      accessibilityRole="button"
      accessibilityLabel={part.filename ? `Play video ${part.filename}` : "Play video"}
      style={({ pressed }) => ({ opacity: pressed ? 0.82 : 1 })}
    >
      <View className="flex-row items-center gap-3 rounded-[12px] border border-border/70 bg-surface px-3 py-3">
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: hexToRgba(palette.ink, 0.08),
          }}
        >
          <Play size={16} color={palette.accentLight} strokeWidth={2.2} />
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[13px] font-semibold text-ink">
            {part.filename ?? "Video"}
          </Text>
          <Text className="mt-0.5 text-[11px] text-muted">
            {failed ? "Video unavailable" : preparing ? "Preparing…" : "Tap to play"}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

function MessageImage({ part }: { part: FilePart }) {
  const { palette } = useAppTheme()
  const [aspectRatio, setAspectRatio] = useState(4 / 3)
  return (
    <View className="overflow-hidden rounded-[12px] border border-border/70 bg-surface">
      <Image
        source={{ uri: part.url }}
        contentFit="contain"
        transition={120}
        onLoad={(event) => {
          const { width, height } = event.source
          if (width > 0 && height > 0) setAspectRatio(width / height)
        }}
        style={{ width: "100%", aspectRatio, maxHeight: 320 }}
        accessibilityLabel={part.filename ?? "Attached image"}
      />
      {part.filename ? (
        <Text numberOfLines={1} className="px-2.5 py-1.5 text-[11px]" style={{ color: palette.muted }}>
          {part.filename}
        </Text>
      ) : null}
    </View>
  )
}

function MessageFileView({ part }: { part: FilePart }) {
  const { palette } = useAppTheme()
  const mime = part.mime.toLowerCase()

  if (mime.startsWith("image/")) {
    return <MessageImage part={part} />
  }

  if (mime.startsWith("video/")) {
    return <MessageVideo part={part} />
  }

  const canOpen = /^https?:/i.test(part.url)
  return (
    <Pressable
      disabled={!canOpen}
      onPress={() => {
        void triggerHaptic("selection")
        void Linking.openURL(part.url).catch(() => undefined)
      }}
      accessibilityRole={canOpen ? "link" : "text"}
      accessibilityLabel={part.filename ?? "Attached file"}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <View className="flex-row items-center gap-2 rounded-[12px] border border-border/70 bg-surface px-3 py-2.5">
        <Paperclip size={14} color={palette.accentLight} strokeWidth={2.1} />
        <Text numberOfLines={1} className="flex-1 text-[12px] font-medium text-ink">
          {part.filename ?? part.mime}
        </Text>
      </View>
    </Pressable>
  )
}

function PathPreview({ files }: { files: string[] }) {
  return (
    <View className="min-w-0 gap-1">
      {files.map((file) => (
        <View key={file} className="overflow-hidden rounded-[12px] border border-border/70 bg-surface px-2.5 py-2">
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
      ))}
    </View>
  )
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

function stableMarkdownCodeKey(node: ASTNode, messageId: string): string {
  if (node.key != null && String(node.key).length > 0) return `${messageId}:${node.key}`
  const code = trimmedCodeContent(node)
  const lang = getLanguage(node)
  let h = 0
  for (let i = 0; i < Math.min(code.length, 240); i++) h = (h * 31 + code.charCodeAt(i)) | 0
  return `${messageId}:cb:${lang}:${code.length}:${h}`
}

function isArtifactFenceLanguage(language: string) {
  const lang = language.toLowerCase()
  if (lang === "html" || lang === "htm" || lang === "svg" || lang === "mermaid") return true
  if (lang.startsWith("artifact:")) {
    const sub = lang.slice("artifact:".length)
    return sub === "html" || sub === "htm" || sub === "svg" || sub === "mermaid"
  }
  return false
}

function ArtifactFencePlaceholder(props: { language: string }) {
  return (
    <View className="my-2 rounded-[8px] border border-border/70 bg-surface px-3 py-2">
      <Text className="text-[11px] font-semibold text-muted">{props.language.toUpperCase()} artifact — open below</Text>
    </View>
  )
}

function MessageArtifactSection(props: { artifacts: SessionPreview[]; onOpen(preview: SessionPreview): void }) {
  const { palette, isDark } = useAppTheme()
  const [primary, ...rest] = props.artifacts

  return (
    <View className="border-t border-border/80 px-3.5 py-3">
      <View className="rounded-[8px] border border-border bg-background/55 p-3">
        <View className="flex-row items-center gap-2">
          <Box size={15} color={palette.accentLight} strokeWidth={2.2} />
          <Text className="flex-1 text-sm font-semibold text-ink">
            {props.artifacts.length === 1 ? "Generated artifact" : `${props.artifacts.length} artifacts`}
          </Text>
        </View>
        {primary ? <InlineArtifactCard preview={primary} onPress={() => props.onOpen(primary)} /> : null}
        <View className={rest.length || props.artifacts.some((artifact) => artifact.url) ? "mt-3 gap-2" : undefined}>
          {rest.map((artifact) => (
            <Pressable
              key={artifact.id}
              onPress={() => {
                void triggerHaptic("selection")
                props.onOpen(artifact)
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${kindLabel(artifact.kind)} artifact`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: isDark ? hexToRgba(palette.ink, 0.1) : hexToRgba(palette.border, 0.72),
                backgroundColor: isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.72)",
                paddingHorizontal: 12,
                paddingVertical: 11,
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <ArtifactMicroThumb preview={artifact} />
              <View className="min-w-0 flex-1">
                <Text className="text-[10px] font-bold uppercase tracking-wide text-muted">
                  {kindLabel(artifact.kind)}
                </Text>
                <Text numberOfLines={1} className="mt-0.5 text-[13px] font-semibold text-ink">
                  {artifact.title}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text className="text-[12px] font-semibold" style={{ color: palette.accentLight }}>
                  Open
                </Text>
                <ChevronRight size={14} color={palette.accentLight} strokeWidth={2.2} />
              </View>
            </Pressable>
          ))}
          {props.artifacts
            .filter((artifact) => Boolean(artifact.url))
            .map((artifact) => (
              <Pressable
                key={`${artifact.id}:link`}
                onPress={() => {
                  void triggerHaptic("selection")
                  void Linking.openURL(artifact.url!).catch(() => undefined)
                }}
                onLongPress={() => {
                  void Clipboard.setStringAsync(artifact.url!)
                  void triggerHaptic("success")
                }}
                accessibilityRole="link"
                accessibilityLabel={`Open artifact link ${artifact.url}`}
                accessibilityHint="Long press to copy the link"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.72)",
                  borderWidth: 1,
                  borderColor: isDark ? hexToRgba(palette.ink, 0.1) : hexToRgba(palette.border, 0.72),
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Link2 size={13} color={palette.accentLight} strokeWidth={2.2} />
                <Text
                  numberOfLines={1}
                  className="flex-1 text-[12px] font-medium underline"
                  style={{ color: palette.accentLight }}
                >
                  {artifact.url}
                </Text>
              </Pressable>
            ))}
        </View>
      </View>
    </View>
  )
}

function ScrollableCodeBlock(props: { node: ASTNode; textStyle: any; backgroundColor: string; borderColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, markCopied] = useCopiedFeedback(2000)
  const { palette } = useAppTheme()
  const language = getLanguage(props.node)
  const code = trimmedCodeContent(props.node)
  const lineCount = code.split("\n").length
  const isLong = lineCount > 10
  const lineHighlights = useMemo(() => code.split("\n").map((line) => highlightCode(line)), [code])
  const lineHeightPx = 18
  const bodyPadV = 24
  const viewportCap = expanded ? 800 : 400
  const intrinsicBodyH = lineCount * lineHeightPx + bodyPadV
  const codeBodyHeight = Math.min(Math.max(intrinsicBodyH, lineHeightPx + bodyPadV), viewportCap)

  async function handleCopy() {
    await Clipboard.setStringAsync(code)
    markCopied()
  }

  return (
    <View
      className="mt-1 mb-0 overflow-hidden rounded-2xl border"
      style={{
        backgroundColor: palette.codeBlockBackground,
        borderColor: palette.border,
      }}
    >
      <View
        className="flex-row items-center justify-between border-b px-4 py-2.5"
        style={{
          backgroundColor: `${palette.codeBlockBackground}dd`,
          borderBottomColor: palette.border,
        }}
      >
        <View className="flex-row items-center gap-2">
          <View className="size-2.5 rounded-full" style={{ backgroundColor: "#ff5f57" }} />
          <View className="size-2.5 rounded-full" style={{ backgroundColor: "#ffbd2e" }} />
          <View className="size-2.5 rounded-full" style={{ backgroundColor: "#28c840" }} />
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
            style={{
              backgroundColor: copied ? `${palette.success}30` : `${palette.border}40`,
            }}
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
        style={{
          height: codeBodyHeight,
          maxHeight: viewportCap,
          flexGrow: 0,
          alignSelf: "stretch",
        }}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingVertical: 12,
          alignItems: "flex-start",
        }}
      >
        <View>
          {lineHighlights.map((lineHighlighted, lineIndex) => (
            <Text
              key={`line-${lineIndex}`}
              selectable
              className="text-[11px] leading-[18px]"
              style={{ fontFamily: "Menlo" }}
            >
              {lineHighlighted.map((seg, i) => (
                <Text key={`${lineIndex}:${i}`} style={{ color: seg.color }}>
                  {seg.text}
                </Text>
              ))}
              {"\n"}
            </Text>
          ))}
        </View>
      </ScrollView>
      {isLong && (
        <Pressable
          onPress={() => setExpanded(!expanded)}
          className="border-t py-2.5"
          style={{
            backgroundColor: `${palette.codeBlockBackground}dd`,
            borderTopColor: palette.border,
          }}
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
      accessibilityRole="button"
      accessibilityLabel={props.label}
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

type MessageBubbleProps = {
  message: MessageWithParts
  diffs?: FileDiff[]
  diffLoaded?: boolean
  diffLoading?: boolean
  onLoadDiff?(messageID: string): void
  onCopy?: (message: MessageWithParts) => void
  onFork?: (message: MessageWithParts) => void
  onDismiss?: () => void
  onActivate?(messageID: string): void
  onOpenArtifact?(preview: SessionPreview): void
  queued?: boolean
  isActive?: boolean
}

function MessageBubbleImpl(props: MessageBubbleProps) {
  const { palette, isDark } = useAppTheme()
  const gestures = useUIStore((state) => state.gestures)
  const [showReasoning, setShowReasoning] = useState(false)
  const reasoningRotationRef = useRef<Animated.Value | null>(null)
  if (reasoningRotationRef.current === null) reasoningRotationRef.current = new Animated.Value(0)
  const reasoningRotation = reasoningRotationRef.current
  const text = useMemo(() => latestText(props.message.parts), [props.message.parts])
  const reasoning = useMemo(() => reasoningParts(props.message.parts), [props.message.parts])
  const patch = useMemo(() => patchPart(props.message.parts), [props.message.parts])
  const tools = useMemo(() => toolParts(props.message.parts), [props.message.parts])
  const files = useMemo(() => fileParts(props.message.parts), [props.message.parts])
  const messageArtifacts = useMemo(() => extractMessageArtifacts(props.message), [props.message])
  const hasArtifactFences = messageArtifacts.length > 0
  const isUser = props.message.info.role === "user"
  const hasReusableText = Boolean(text.trim())
  const canCopy = hasReusableText && props.onCopy
  const canFork = hasReusableText && props.onFork

  const assistantInfo = !isUser ? (props.message.info as AssistantMessage) : null
  const assistantError = assistantInfo?.error?.data?.message
  const cost = assistantInfo?.cost ?? 0
  const tokens = assistantInfo ? assistantInfo.tokens.input + assistantInfo.tokens.output : 0
  const reasoningText = useMemo(
    () => reasoning.flatMap((part) => (part.text.trim() ? [part.text.trim()] : [])).join("\n\n"),
    [reasoning],
  )
  const wordCount = reasoningText ? words(reasoningText) : 0
  const reasoningVisible = reasoning.length > 0
  const reasoningExpanded = showReasoning || wordCount === 0
  const markdownRules = useMemo<RenderRules>(
    () => ({
      code_block: (node, _children, _parent, styles, inheritedStyles = {}) => {
        const language = getLanguage(node)
        if (hasArtifactFences && isArtifactFenceLanguage(language)) {
          return (
            <ArtifactFencePlaceholder key={stableMarkdownCodeKey(node, props.message.info.id)} language={language} />
          )
        }
        return (
          <ScrollableCodeBlock
            key={stableMarkdownCodeKey(node, props.message.info.id)}
            node={node}
            textStyle={[inheritedStyles, styles.code_block]}
            backgroundColor={palette.codeBackground}
            borderColor={palette.border}
          />
        )
      },
      fence: (node, _children, _parent, styles, inheritedStyles = {}) => {
        const language = getLanguage(node)
        if (hasArtifactFences && isArtifactFenceLanguage(language)) {
          return (
            <ArtifactFencePlaceholder key={stableMarkdownCodeKey(node, props.message.info.id)} language={language} />
          )
        }
        return (
          <ScrollableCodeBlock
            key={stableMarkdownCodeKey(node, props.message.info.id)}
            node={node}
            textStyle={[inheritedStyles, styles.fence]}
            backgroundColor={palette.codeBackground}
            borderColor={palette.border}
          />
        )
      },
    }),
    [hasArtifactFences, palette.border, palette.codeBackground, props.message.info.id],
  )
  const summaryLine = useMemo(() => {
    const items = [] as string[]
    if (tools.length) items.push(`${tools.length} tool${tools.length === 1 ? "" : "s"}`)
    if (patch?.files.length) items.push(`${patch.files.length} file${patch.files.length === 1 ? "" : "s"}`)
    if (files.length) items.push(`${files.length} attachment${files.length === 1 ? "" : "s"}`)
    if (messageArtifacts.length)
      items.push(`${messageArtifacts.length} artifact${messageArtifacts.length === 1 ? "" : "s"}`)
    if (reasoning.length) items.push(`reasoning`)
    return items.join(" · ")
  }, [files.length, messageArtifacts.length, patch?.files.length, reasoning.length, tools.length])
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
      create: {
        type: LayoutAnimation.Types.easeOut,
        property: LayoutAnimation.Properties.opacity,
        duration: 200,
      },
      update: {
        type: LayoutAnimation.Types.spring,
        springDamping: 0.8,
        duration: 240,
      },
      delete: {
        type: LayoutAnimation.Types.easeIn,
        property: LayoutAnimation.Properties.opacity,
        duration: 130,
      },
    })
    setShowReasoning(next)
  }

  const bubble = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${isUser ? "User" : "Nikcli"} message`}
      accessibilityHint="Long press to show message actions"
      // Standard chat behavior: tapping the transcript puts the keyboard away.
      onPress={() => Keyboard.dismiss()}
      onLongPress={() => {
        if (!gestures.bubbleLongPressActions) return
        props.onActivate?.(props.message.info.id)
        void triggerHaptic("selection")
      }}
      delayLongPress={180}
    >
      <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
        <View
          className={`max-w-[95%] min-w-0 overflow-hidden rounded-[8px] border ${isUser ? "border-accent/35 bg-user-bubble" : "border-border bg-assistant-bubble"}`}
          style={{
            shadowColor: palette.shadow,
            shadowOpacity: isDark ? 0.18 : 0.1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
          }}
        >
          <View className="min-w-0 flex-row items-start justify-between gap-3 px-3.5 py-3">
            <View className="min-w-0 flex-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <View
                  style={{
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: isUser
                      ? hexToRgba(palette.ink, isDark ? 0.12 : 0.18)
                      : isDark
                        ? hexToRgba(palette.ink, 0.08)
                        : hexToRgba(palette.border, 0.72),
                    backgroundColor: isUser
                      ? hexToRgba(palette.ink, isDark ? 0.08 : 0.1)
                      : isDark
                        ? "rgba(255,255,255,0.04)"
                        : "rgba(247,246,242,0.78)",
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <Text className="text-[12px] font-medium text-muted">{isUser ? "You" : "Nikcli"}</Text>
                  {props.queued ? (
                    <View
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        backgroundColor: hexToRgba(palette.ink, 0.1),
                      }}
                    >
                      <Text className="text-[10px] font-bold uppercase tracking-wide text-muted">Queued</Text>
                    </View>
                  ) : null}
                </View>
                {summaryLine ? <Text className="text-[11px] leading-4 text-soft">{summaryLine}</Text> : null}
              </View>
            </View>
            <View className="items-end gap-1">
              {assistantInfo && (cost > 0 || tokens > 0) ? (
                <Text className="text-[10px] text-muted" style={{ fontVariant: ["tabular-nums"] }}>
                  {cost > 0 ? `$${cost < 0.001 ? cost.toFixed(5) : cost.toFixed(4)}` : null}
                  {cost > 0 && tokens > 0 ? " · " : null}
                  {tokens > 0 ? `${tokens.toLocaleString()} tok` : null}
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
                    body: {
                      color: palette.ink,
                      fontSize: 14,
                      lineHeight: 22,
                      marginBottom: 0,
                    },
                    paragraph: { marginTop: 0, marginBottom: 8 },
                    heading1: {
                      color: palette.ink,
                      fontSize: 18,
                      fontWeight: "700",
                      marginTop: 12,
                      marginBottom: 8,
                    },
                    heading2: {
                      color: palette.ink,
                      fontSize: 16,
                      fontWeight: "700",
                      marginTop: 10,
                      marginBottom: 6,
                    },
                    heading3: {
                      color: palette.ink,
                      fontSize: 14,
                      fontWeight: "700",
                      marginTop: 8,
                      marginBottom: 4,
                    },
                    heading4: {
                      color: palette.ink,
                      fontSize: 12,
                      fontWeight: "600",
                      marginTop: 4,
                      marginBottom: 3,
                    },
                    heading5: {
                      color: palette.ink,
                      fontSize: 11,
                      fontWeight: "600",
                      marginTop: 4,
                      marginBottom: 2,
                    },
                    heading6: {
                      color: palette.muted,
                      fontSize: 10,
                      fontWeight: "600",
                      marginTop: 4,
                      marginBottom: 2,
                    },
                    strong: { fontWeight: "700" },
                    em: { fontStyle: "italic" },
                    s: {
                      textDecorationLine: "line-through",
                      color: palette.muted,
                    },
                    hr: {
                      backgroundColor: palette.border,
                      height: StyleSheet.hairlineWidth,
                      marginVertical: 12,
                    },
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
                    bullet_list_icon: {
                      color: palette.accentLight,
                      marginRight: 6,
                    },
                    bullet_list_content: {
                      flex: undefined,
                      flexGrow: 1,
                      flexShrink: 1,
                    },
                    ordered_list_icon: {
                      color: palette.accentLight,
                      marginRight: 6,
                    },
                    ordered_list_content: {
                      flex: undefined,
                      flexGrow: 1,
                      flexShrink: 1,
                    },
                    code_inline: {
                      color: palette.accentLight,
                      backgroundColor: palette.codeBackground,
                      borderRadius: 4,
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
                    link: {
                      color: palette.accentLight,
                      textDecorationLine: "underline",
                    },
                  }}
                >
                  {text}
                </Markdown>
              ) : null}

              {assistantError ? (
                <View className="rounded-[8px] border border-danger/25 bg-danger/10 px-3 py-2.5">
                  <Text selectable className="text-sm leading-5" style={{ color: palette.danger }}>
                    {assistantError}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {files.length ? (
            <View className="gap-2 border-t border-border/80 px-3.5 py-3">
              {files.map((part) => (
                <MessageFileView key={part.id} part={part} />
              ))}
            </View>
          ) : null}

          {messageArtifacts.length > 0 ? (
            <MessageArtifactSection
              artifacts={messageArtifacts}
              onOpen={(preview) => {
                if (props.onOpenArtifact) props.onOpenArtifact(preview)
                else if (preview.url) void Linking.openURL(preview.url).catch(() => undefined)
              }}
            />
          ) : null}

          {reasoningVisible ? (
            <View className="border-t border-border/80 px-3.5 py-3">
              <View className="rounded-[8px] border border-border bg-background/55 p-3">
                <Pressable
                  onPress={toggleReasoning}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: reasoningExpanded }}
                  accessibilityLabel={reasoningExpanded ? "Collapse reasoning" : "Expand reasoning"}
                  className="flex-row items-center gap-2"
                >
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
                  <Text className="flex-1 text-[12px] font-medium text-muted">
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
              <View className="rounded-[8px] border border-border bg-background/55 p-3">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-sm font-semibold text-ink">Patch preview</Text>
                  {!props.diffLoaded ? (
                    <Pressable
                      onPress={() => props.onLoadDiff?.(props.message.info.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Load patch diff"
                    >
                      <Text className="text-[12px] font-medium text-muted">
                        {props.diffLoading ? "Loading..." : "Load diff"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <ScrollView className="mt-2 max-h-28" nestedScrollEnabled style={{ flexGrow: 0 }}>
                  <PathPreview files={patch.files} />
                </ScrollView>
                {props.diffLoaded ? (
                  props.diffs?.length ? (
                    <DiffViewer diffs={props.diffs} />
                  ) : (
                    <View className="mt-3 rounded-[8px] border border-border/70 bg-surface px-3 py-2.5">
                      <Text className="text-sm leading-5 text-soft">
                        No structured diff is available for this patch step.
                      </Text>
                    </View>
                  )
                ) : null}
              </View>
            </View>
          ) : null}

          {props.isActive && (canCopy || canFork || props.onDismiss) ? (
            <View className="flex-row flex-wrap gap-2 border-t border-border/80 px-3.5 py-3">
              {canCopy ? <ActionChip label="Copy" onPress={() => props.onCopy?.(props.message)} icon={Copy} /> : null}
              {canFork ? (
                <ActionChip label="Reuse" onPress={() => props.onFork?.(props.message)} icon={GitBranch} />
              ) : null}
              {props.onDismiss ? <ActionChip label="Dismiss" onPress={props.onDismiss} icon={X} muted /> : null}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )

  if (!gestures.bubbleSwipeActions || (!canCopy && !canFork && !props.onDismiss)) {
    return bubble
  }

  return (
    <Swipeable
      overshootRight={false}
      renderRightActions={() => (
        <View className="mb-3 ml-2 flex-row items-center gap-2 self-stretch">
          {canCopy ? <ActionChip label="Copy" onPress={() => props.onCopy?.(props.message)} icon={Copy} /> : null}
          {canFork ? <ActionChip label="Reuse" onPress={() => props.onFork?.(props.message)} icon={GitBranch} /> : null}
          {props.onDismiss ? <ActionChip label="Hide" onPress={props.onDismiss} icon={X} muted /> : null}
        </View>
      )}
      onSwipeableWillOpen={() => {
        props.onActivate?.(props.message.info.id)
        void triggerHaptic("selection")
      }}
    >
      {bubble}
    </Swipeable>
  )
}

function messageBubblePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  // `upsertMessage`/`upsertPart` preserve the object reference of untouched
  // messages, so a reference check on `message` is enough to skip re-renders of
  // bubbles that did not change during streaming.
  return (
    prev.message === next.message &&
    prev.diffs === next.diffs &&
    prev.diffLoaded === next.diffLoaded &&
    prev.diffLoading === next.diffLoading &&
    prev.isActive === next.isActive &&
    prev.onLoadDiff === next.onLoadDiff &&
    prev.onCopy === next.onCopy &&
    prev.onFork === next.onFork &&
    prev.onDismiss === next.onDismiss &&
    prev.onActivate === next.onActivate &&
    prev.onOpenArtifact === next.onOpenArtifact &&
    prev.queued === next.queued
  )
}

export const MessageBubble = memo(MessageBubbleImpl, messageBubblePropsEqual)
