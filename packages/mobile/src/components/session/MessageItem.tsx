import { View, StyleSheet, Pressable, Platform } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { format } from "date-fns"
import { MotiView } from "moti"
import { User, Bot, Terminal, AlertCircle } from "lucide-react-native"
import Markdown from "react-native-markdown-display"
import { Card } from "../ui/Card"

interface MessageItemProps {
  message: {
    id: string
    role: "user" | "assistant" | "system"
    content: string
    parts?: { id: string; type: string; content: string }[]
    createdAt: Date
  }
  onPress?: () => void
}

export function MessageItem({ message, onPress }: MessageItemProps) {
  const theme = useTheme()
  const isUser = message.role === "user"
  const isSystem = message.role === "system"

  const roleConfig = {
    user: { icon: User, color: theme.colors.primary, bg: theme.colors.primaryContainer },
    assistant: { icon: Bot, color: theme.colors.secondary, bg: theme.colors.secondaryContainer },
    system: { icon: Terminal, color: theme.colors.tertiary, bg: theme.colors.tertiaryContainer },
  }

  const config = roleConfig[message.role]
  const Icon = config.icon

  return (
    <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} style={styles.container}>
      <Pressable onPress={onPress}>
        <Card variant={isUser ? "outlined" : "elevated"} padding="md" interactive={!!onPress}>
          <View style={styles.header}>
            <View style={[styles.avatar, { backgroundColor: config.bg }]}>
              <Icon size={18} color={config.color} />
            </View>
            <View style={styles.meta}>
              <Text style={[styles.role, { color: config.color }]}>{message.role}</Text>
              <Text style={[styles.time, { color: theme.colors.onSurfaceVariant }]}>
                {format(new Date(message.createdAt), "HH:mm:ss")}
              </Text>
            </View>
          </View>

          <View style={styles.content}>
            <Markdown
              style={{
                body: {
                  color: theme.colors.onSurface,
                  fontSize: 14,
                },
                code_inline: {
                  backgroundColor: theme.colors.surfaceVariant,
                  padding: 4,
                  borderRadius: 4,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                },
                code_block: {
                  backgroundColor: theme.colors.surfaceVariant,
                  padding: 12,
                  borderRadius: 8,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                },
              }}
            >
              {message.content}
            </Markdown>
          </View>

          {message.parts && message.parts.length > 0 && (
            <View style={styles.partsContainer}>
              <Text style={[styles.partsLabel, { color: theme.colors.onSurfaceVariant }]}>
                Parts ({message.parts.length})
              </Text>
              {message.parts.map((part) => (
                <View key={part.id} style={[styles.part, { backgroundColor: theme.colors.surfaceVariant }]}>
                  <Text style={[styles.partType, { color: theme.colors.primary }]}>{part.type}</Text>
                  <Text style={[styles.partContent, { color: theme.colors.onSurface }]} numberOfLines={2}>
                    {part.content}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      </Pressable>
    </MotiView>
  )
}

interface ErrorMessageProps {
  error: string
  onRetry?: () => void
}

export function ErrorMessage({ error, onRetry }: ErrorMessageProps) {
  const theme = useTheme()

  return (
    <MotiView
      from={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      style={[styles.errorContainer, { backgroundColor: theme.colors.errorContainer }]}
    >
      <View style={styles.errorHeader}>
        <AlertCircle size={20} color={theme.colors.onErrorContainer} />
        <Text style={[styles.errorTitle, { color: theme.colors.onErrorContainer }]}>Error</Text>
      </View>
      <Text style={[styles.errorText, { color: theme.colors.onErrorContainer }]}>{error}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Text style={[styles.retryText, { color: theme.colors.onErrorContainer }]}>Tap to retry</Text>
        </Pressable>
      )}
    </MotiView>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  meta: {
    flex: 1,
  },
  role: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  time: {
    fontSize: 11,
  },
  content: {
    marginLeft: 48,
  },
  partsContainer: {
    marginTop: 12,
    marginLeft: 48,
    gap: 8,
  },
  partsLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  part: {
    padding: 8,
    borderRadius: 6,
    gap: 4,
  },
  partType: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  partContent: {
    fontSize: 12,
  },
  errorContainer: {
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  errorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 13,
  },
  retryButton: {
    marginTop: 8,
    padding: 8,
    alignItems: "center",
  },
  retryText: {
    fontSize: 13,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
})
