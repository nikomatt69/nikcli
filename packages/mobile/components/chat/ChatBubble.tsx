import { useCallback, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Check, CheckCheck, AlertCircle, Clock, Reply, Trash2, Copy, type LucideIcon } from "lucide-react-native"
import * as Clipboard from "expo-clipboard"
import { Image } from "expo-image"
import { useAppTheme, useChatTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import type { ChatMessage, ChatMessageStatus } from "@/lib/chat-types"
import { cn } from "@/lib/cn"

interface ChatBubbleProps {
  message: ChatMessage
  isOwn: boolean
  showAvatar?: boolean
  showTimestamp?: boolean
  showStatus?: boolean
  grouped?: boolean
  onReply?: (messageId: string) => void
  onCopy?: (messageId: string) => void
  onDelete?: (messageId: string) => void
  onReact?: (messageId: string, emoji: string) => void
  onLongPress?: (messageId: string) => void
}

export function ChatBubble({
  message,
  isOwn,
  showTimestamp = true,
  showStatus = true,
  grouped = false,
  onReply,
  onDelete,
  onReact,
  onLongPress,
}: ChatBubbleProps) {
  const { palette } = useAppTheme()
  const chat = useChatTheme()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(message.content)
    setCopied(true)
    triggerHaptic("success")
    setTimeout(() => setCopied(false), 2000)
  }, [message.content])

  const handleReply = useCallback(() => {
    onReply?.(message.id)
    triggerHaptic("selection")
  }, [message.id, onReply])

  const handleDelete = useCallback(() => {
    onDelete?.(message.id)
    triggerHaptic("error")
  }, [message.id, onDelete])

  const handleLongPress = useCallback(() => {
    onLongPress?.(message.id)
    triggerHaptic("selection")
  }, [message.id, onLongPress])

  const bubbleBg = isOwn ? chat.userBubbleBg : chat.receivedBubbleBg
  const textColor = isOwn ? chat.userBubbleText : chat.receivedBubbleText

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const StatusIcon: Record<ChatMessageStatus, LucideIcon> = {
    sending: Clock,
    sent: Check,
    delivered: Check,
    read: CheckCheck,
    failed: AlertCircle,
  }

  const StatusIconComponent = StatusIcon[message.status]
  const statusColor = message.status === "read" ? chat.readReceiptRead : chat.readReceiptSent

  // iMessage-style grouped corner: connecting side is less rounded when grouped
  const topLeftRadius = grouped && !isOwn ? chat.bubbleTailRadius : chat.bubbleRadius
  const topRightRadius = grouped && isOwn ? chat.bubbleTailRadius : chat.bubbleRadius

  return (
    <View className={cn("mb-0.5", grouped ? "mt-0.5" : "mt-2", isOwn ? "items-end" : "items-start")}>
      <Pressable
        onLongPress={handleLongPress}
        onPressIn={() => triggerHaptic("selection")}
        delayLongPress={350}
        className={cn("max-w-[80%] overflow-hidden")}
        style={({ pressed }) => ({
          backgroundColor: bubbleBg,
          borderRadius: chat.bubbleRadius,
          paddingHorizontal: chat.bubblePaddingH + 2,
          paddingVertical: chat.bubblePaddingV + 2,
          opacity: pressed ? 0.92 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          borderTopLeftRadius: topLeftRadius,
          borderTopRightRadius: topRightRadius,
          borderBottomLeftRadius: isOwn ? chat.bubbleRadius : chat.bubbleTailRadius,
          borderBottomRightRadius: isOwn ? chat.bubbleTailRadius : chat.bubbleRadius,
          shadowColor: isOwn ? bubbleBg : "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isOwn ? 0 : 0.08,
          shadowRadius: 8,
        })}
      >
        {message.replyToId && (
          <View
            className="mb-2 rounded-lg"
            style={{
              borderLeftWidth: 3,
              borderLeftColor: isOwn ? "rgba(255,255,255,0.4)" : palette.accent,
              paddingLeft: 8,
            }}
          >
            <Text
              className="text-[11px] font-medium"
              style={{ color: isOwn ? "rgba(255,255,255,0.7)" : palette.accent }}
            >
              ↩ Reply
            </Text>
          </View>
        )}

        <Text className="text-[15.5px] leading-[22px]" style={{ color: textColor }}>
          {message.content}
        </Text>

        {message.attachments?.map((attachment) => (
          <View key={attachment.id} className="mt-2">
            {attachment.type === "image" && (
              <Image
                source={{ uri: attachment.url }}
                className="rounded-2xl overflow-hidden"
                style={{ width: 220, height: 160 }}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
            )}
          </View>
        ))}

        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {Object.entries(message.reactions).map(([emoji, users]) => (
              <Pressable
                key={emoji}
                onPress={() => onReact?.(message.id, emoji)}
                className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
                style={{ backgroundColor: chat.reactionBg }}
              >
                <Text className="text-[15px]">{emoji}</Text>
                <Text className="text-[12px] font-semibold" style={{ color: textColor, opacity: 0.8 }}>
                  {users.length}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {showTimestamp && (
          <View className="mt-1.5 flex-row items-center justify-end gap-2">
            <Text
              className="text-[10.5px]"
              style={{ color: isOwn ? "rgba(255,255,255,0.55)" : chat.timestampColor, fontWeight: "500" }}
            >
              {formatTime(message.createdAt)}
            </Text>
            {isOwn && showStatus && <StatusIconComponent size={11} color={statusColor} strokeWidth={2.5} />}
          </View>
        )}
      </Pressable>

      {copied && (
        <View style={styles.copiedToast}>
          <Text className="text-[11px] font-medium text-white">Copied!</Text>
        </View>
      )}
    </View>
  )
}

export function QuickReactionPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const { isDark } = useAppTheme()
  const reactions = ["👍", "❤️", "😂", "😮", "😢", "🎉"]

  return (
    <View
      className="rounded-2xl p-2.5"
      style={{
        backgroundColor: isDark ? "rgba(44,44,46,0.95)" : "rgba(255,255,255,0.95)",
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <View className="flex-row gap-2">
        {reactions.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => {
              onSelect(emoji)
              triggerHaptic("success")
            }}
            className="items-center justify-center rounded-full p-2"
            style={({ pressed }) => ({
              backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
              transform: [{ scale: pressed ? 0.85 : 1 }],
            })}
          >
            <Text className="text-[26px]">{emoji}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

export function DateSeparator({ timestamp }: { timestamp: number }) {
  const { palette, isDark } = useAppTheme()

  const formatDate = (ts: number) => {
    const date = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) return "Today"
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
    return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })
  }

  return (
    <View className="my-5 items-center">
      <View
        className="rounded-full px-5 py-2"
        style={{ backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }}
      >
        <Text className="text-[12px] font-medium tracking-wide" style={{ color: palette.muted }}>
          {formatDate(timestamp)}
        </Text>
      </View>
    </View>
  )
}

export function UnreadIndicator({ count }: { count: number }) {
  const chat = useChatTheme()

  return (
    <View className="my-3 items-center">
      <View className="rounded-full px-4 py-2" style={{ backgroundColor: chat.listUnreadDot }}>
        <Text className="text-[12px] font-semibold text-white">
          {count} new {count === 1 ? "message" : "messages"}
        </Text>
      </View>
    </View>
  )
}

export function VoiceMessageBubble({
  message,
  isOwn,
  onPlay,
  isPlaying,
}: {
  message: ChatMessage
  isOwn: boolean
  onPlay: () => void
  isPlaying: boolean
}) {
  const chat = useChatTheme()

  const bubbleBg = isOwn ? chat.userBubbleBg : chat.receivedBubbleBg

  // Memoize waveform so Math.random() only runs once per message
  const waveform = useMemo(
    () => message.voiceWaveform ?? Array.from({ length: 30 }, () => 0.3 + Math.random() * 0.7),
    [message.voiceWaveform],
  )
  const progress = 0.6

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <View className={cn("mb-0.5", isOwn ? "items-end" : "items-start")}>
      <Pressable
        className="max-w-[260px] rounded-2xl py-4"
        style={{
          backgroundColor: bubbleBg,
          paddingHorizontal: 16,
          borderTopLeftRadius: chat.bubbleRadius,
          borderTopRightRadius: chat.bubbleRadius,
          borderBottomLeftRadius: isOwn ? chat.bubbleRadius : chat.bubbleTailRadius,
          borderBottomRightRadius: isOwn ? chat.bubbleTailRadius : chat.bubbleRadius,
        }}
        onPress={onPlay}
      >
        <View className="flex-row items-center gap-3">
          <View
            className="items-center justify-center rounded-full"
            style={{ width: 40, height: 40, backgroundColor: "rgba(255,255,255,0.2)" }}
          >
            <Text className="text-[16px]" style={{ color: "#FFFFFF" }}>
              {isPlaying ? "⏸" : "▶"}
            </Text>
          </View>

          <View className="h-10 flex-1 flex-row items-center gap-[3px]">
            {waveform.map((value, i) => (
              <View
                key={i}
                style={{
                  width: 3,
                  height: `${value * 100}%`,
                  backgroundColor:
                    i / waveform.length < progress ? chat.voiceWaveformProgress : chat.voiceWaveform,
                  borderRadius: 2,
                  opacity: i / waveform.length < progress ? 1 : 0.4,
                }}
              />
            ))}
          </View>
        </View>

        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-[11px]" style={{ color: chat.voiceDuration }}>
            {formatDuration(message.voiceDuration)}
          </Text>
          {isOwn && (
            <Text className="text-[11px]" style={{ color: chat.voiceDuration }}>
              ✓✓
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  copiedToast: {
    position: "absolute",
    top: -32,
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.82)",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
})
