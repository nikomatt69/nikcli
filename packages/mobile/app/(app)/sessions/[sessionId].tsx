import { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native"
import { useFocusEffect, useLocalSearchParams } from "expo-router"
import { MessageBubble } from "@/components/MessageBubble"
import { PermissionCard } from "@/components/PermissionCard"
import { useServer } from "@/lib/server-provider"
import type { FileDiff, MessageWithParts, SessionDetail, SessionStreamEvent } from "@/lib/types"
import { useSessionStream } from "@/hooks/use-session-stream"

function upsertMessage(messages: MessageWithParts[], next: MessageWithParts["info"]) {
  const existing = messages.find((item) => item.info.id === next.id)
  if (existing) {
    existing.info = next
    return [...messages]
  }
  return [...messages, { info: next, parts: [] }].sort((a, b) => a.info.time.created - b.info.time.created)
}

function upsertPart(messages: MessageWithParts[], part: MessageWithParts["parts"][number]) {
  const index = messages.findIndex((item) => item.info.id === part.messageID)
  if (index === -1) return messages
  const next = [...messages]
  const message = { ...next[index], parts: [...next[index].parts] }
  const partIndex = message.parts.findIndex((item) => item.id === part.id)
  if (partIndex === -1) message.parts.push(part)
  else message.parts[partIndex] = part
  next[index] = message
  return next
}

export default function SessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const { client, config } = useServer()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Record<string, FileDiff[]>>({})

  const load = useCallback(async () => {
    if (!client || !sessionId) return
    try {
      setLoading(true)
      setDetail(await client.getSession(sessionId))
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client, sessionId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useSessionStream({
    config,
    sessionID: sessionId,
    enabled: Boolean(config && sessionId),
    onEvent(event: SessionStreamEvent) {
      setDetail((current) => {
        if (!current) return current
        if (event.type === "message.updated")
          return { ...current, messages: upsertMessage(current.messages, event.properties.info) }
        if (event.type === "message.part.updated")
          return { ...current, messages: upsertPart(current.messages, event.properties.part) }
        if (event.type === "message.removed")
          return {
            ...current,
            messages: current.messages.filter((item) => item.info.id !== event.properties.messageID),
          }
        if (event.type === "message.part.removed") {
          return {
            ...current,
            messages: current.messages.map((item) =>
              item.info.id === event.properties.messageID
                ? { ...item, parts: item.parts.filter((part) => part.id !== event.properties.partID) }
                : item,
            ),
          }
        }
        if (event.type === "session.updated") return { ...current, info: event.properties.info }
        if (event.type === "session.status") return { ...current, status: event.properties.status }
        if (event.type === "session.idle") return { ...current, status: { type: "idle" } }
        if (event.type === "permission.asked")
          return { ...current, permissions: [...current.permissions, event.properties] }
        if (event.type === "permission.replied") {
          return {
            ...current,
            permissions: current.permissions.filter((item) => item.id !== event.properties.requestID),
          }
        }
        return current
      })
    },
    onError(message) {
      setError(message)
    },
  })

  const messages = useMemo(() => detail?.messages ?? [], [detail])

  async function send() {
    if (!client || !sessionId || !input.trim()) return
    try {
      setSending(true)
      await client.sendMessage(sessionId, input.trim())
      setInput("")
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  async function loadDiff(messageID: string) {
    if (!client || !sessionId || diffs[messageID]) return
    const next = await client.getDiff(sessionId, messageID)
    setDiffs((current) => ({ ...current, [messageID]: next }))
  }

  async function respond(permissionID: string, response: "once" | "always" | "reject") {
    if (!client || !sessionId) return
    await client.respondToPermission(sessionId, permissionID, response)
  }

  async function abort() {
    if (!client || !sessionId) return
    await client.abortSession(sessionId)
  }

  if (loading && !detail) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fbbf24" />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View className="border-b border-border px-4 pb-4 pt-4">
        <View className="rounded-[28px] border border-border bg-surface px-4 py-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Live session</Text>
              <Text className="mt-2 text-xl font-semibold text-ink">{detail?.info.title || "Session"}</Text>
              <Text className="mt-1 text-sm text-soft">{detail?.status?.type ?? "idle"}</Text>
            </View>
            <Pressable
              onPress={() => void abort()}
              className="rounded-full border border-border bg-background/70 px-4 py-2.5"
            >
              <Text className="text-sm font-semibold text-ink">Abort</Text>
            </Pressable>
          </View>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <View className="rounded-full bg-background/70 px-3 py-2">
              <Text className="text-[11px] font-semibold text-ink">{messages.length} messages</Text>
            </View>
            <View className="rounded-full bg-background/70 px-3 py-2">
              <Text className="text-[11px] font-semibold text-ink">{detail?.permissions.length ?? 0} approvals</Text>
            </View>
          </View>
        </View>
        {error ? <Text className="mt-3 text-sm text-rose-300">{error}</Text> : null}
      </View>

      <FlatList
        className="flex-1 px-4 pt-4"
        data={messages}
        keyExtractor={(item) => item.info.id}
        renderItem={({ item }) => <MessageBubble message={item} diffs={diffs[item.info.id]} onLoadDiff={loadDiff} />}
        ListHeaderComponent={
          detail?.permissions.length ? (
            <View className="mb-2">
              {detail.permissions.map((item) => (
                <PermissionCard key={item.id} item={item} onRespond={(response) => void respond(item.id, response)} />
              ))}
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />

      <View className="border-t border-border px-4 pb-6 pt-3">
        <View className="flex-row items-end gap-3 rounded-[28px] border border-border bg-surface px-4 py-3">
          <TextInput
            value={input}
            onChangeText={setInput}
            multiline
            placeholder="Ask Nikcli to inspect, edit, review, or commit..."
            placeholderTextColor="#6d84a0"
            className="max-h-32 flex-1 text-base leading-6 text-ink"
          />
          <Pressable
            disabled={sending || !input.trim()}
            onPress={() => void send()}
            className="rounded-full bg-accent px-4 py-3"
          >
            <Text className="font-semibold text-slate-950">Send</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
