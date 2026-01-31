import { useLocalSearchParams, router } from "expo-router"
import { View, StyleSheet, FlatList, Pressable } from "react-native"
import { Text, useTheme } from "react-native-paper"
import { MotiView } from "moti"
import { ArrowLeft, Send, Terminal, MoreVertical } from "lucide-react-native"
import { useEffect, useState, useRef } from "react"
import { Card, Button, Input, Badge, Loading } from "@/components/ui"
import { MessageItem } from "@/components/session"
import { ConnectionStatusIndicator } from "@/components/sse"
import { useSessionsStore } from "@/stores"
import { useHapticFeedback } from "@/hooks/useHaptics"

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const theme = useTheme()
  const { light } = useHapticFeedback()
  const sessionsStore = useSessionsStore()
  const flatListRef = useRef<FlatList>(null)

  const session = sessionsStore.getSession(id)
  const messages = sessionsStore.getSessionMessages(id)
  const [input, setInput] = useState("")

  useEffect(() => {
    if (session) {
      sessionsStore.setActive(id)
    }
  }, [id])

  if (!session) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Loading text="Loading session..." />
      </View>
    )
  }

  const handleSend = () => {
    if (!input.trim()) return
    light()
    setInput("")
  }

  const statusVariant = {
    active: "success",
    idle: "default",
    error: "error",
    stopped: "default",
  } as const

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color={theme.colors.onSurface} />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={[styles.sessionName, { color: theme.colors.onSurface }]}>{session.name}</Text>
            <Badge variant={statusVariant[session.status]} size="sm">
              {session.status}
            </Badge>
          </View>
          <Pressable style={styles.moreButton}>
            <MoreVertical size={24} color={theme.colors.onSurface} />
          </Pressable>
        </View>

        <ConnectionStatusIndicator status="connected" lastEventAt={session.lastActivity.getTime()} serverUrl={null} />
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={({ item }) => <MessageItem message={item} />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Terminal size={48} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No messages yet</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface }]}>
        <Input
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."

          onSubmitEditing={handleSend}
          returnKeyType="send"

        />
        <Pressable
          onPress={handleSend}
          style={[
            styles.sendButton,
            { backgroundColor: input.trim() ? theme.colors.primary : theme.colors.surfaceVariant },
          ]}
          disabled={!input.trim()}
        >
          <Send size={20} color={input.trim() ? theme.colors.onPrimary : theme.colors.onSurfaceVariant} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  headerInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionName: {
    fontSize: 18,
    fontWeight: "600",
  },
  moreButton: {
    padding: 4,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyContainer: {
    alignItems: "center",
    padding: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 8,
  },
  input: {
    flex: 1,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
})
