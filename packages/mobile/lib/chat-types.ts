// Chat UI Types - iOS 2026 Style

export type ChatMessageStatus = "sending" | "sent" | "delivered" | "read" | "failed"

export type ChatMessageType = "text" | "image" | "voice" | "file" | "system"

export interface ChatUser {
  id: string
  name: string
  avatar?: string
  status?: "online" | "offline" | "busy"
  lastSeen?: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  content: string
  type: ChatMessageType
  status: ChatMessageStatus
  createdAt: number
  updatedAt?: number
  replyToId?: string
  reactions?: Record<string, string[]>
  attachments?: ChatAttachment[]
  voiceDuration?: number
  voiceWaveform?: number[]
  metadata?: Record<string, unknown>
}

export interface ChatAttachment {
  id: string
  type: "image" | "video" | "file" | "audio"
  url: string
  thumbnail?: string
  name: string
  size: number
  mimeType: string
  duration?: number
  width?: number
  height?: number
}

export interface ChatConversation {
  id: string
  participants: ChatUser[]
  type: "direct" | "group"
  name?: string
  avatar?: string
  lastMessage?: ChatMessage
  unreadCount: number
  isPinned: boolean
  isMuted: boolean
  isArchived: boolean
  createdAt: number
  updatedAt: number
  typingUsers?: string[]
}

export interface ChatReaction {
  emoji: string
  count: number
  users: string[]
  isSelected: boolean
}

export interface ChatTypingIndicator {
  conversationId: string
  users: ChatUser[]
}

// iOS-style message bubble variants
export type BubbleVariant = "sent" | "received" | "system"

export interface BubbleStyle {
  backgroundColor: string
  textColor: string
  borderRadius: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number }
  alignment: "left" | "right"
  showTail: boolean
}

// iOS-style status indicators
export const CHAT_STATUS_ICONS: Record<ChatMessageStatus, { icon: string; color: string }> = {
  sending: { icon: "clock", color: "#8E8E93" },
  sent: { icon: "check", color: "#8E8E93" },
  delivered: { icon: "check-check", color: "#8E8E93" },
  read: { icon: "check-check", color: "#007AFF" },
  failed: { icon: "alert-circle", color: "#FF3B30" },
}

// iOS-style quick reactions
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"]

// Grouping constants
export const MESSAGE_GROUP_THRESHOLD_MS = 60_000 // 1 minute
export const DATE_SEPARATOR_THRESHOLD_MS = 3_600_000 // 1 hour

// Pagination
export const MESSAGES_PAGE_SIZE = 50
export const CONVERSATIONS_PAGE_SIZE = 20
