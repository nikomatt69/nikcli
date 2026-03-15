import { useCallback, useMemo, useState } from "react"
import { ArrowLeft } from "lucide-react-native"
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { MessageBubble } from "@/components/MessageBubble"
import { PermissionCard } from "@/components/PermissionCard"
import { SessionComposer } from "@/components/session/SessionComposer"
import { PublishSheet } from "@/components/session/PublishSheet"
import { SessionSummaryCard } from "@/components/session/SessionSummaryCard"
import { EmptyState } from "@/components/ui/EmptyState"
import { useServer } from "@/lib/server-provider"
import {
  MOBILE_DEFAULT_MODEL_ID,
  MOBILE_DEFAULT_PROVIDER_ID,
  type FileDiff,
  type MessageWithParts,
  type SessionDetail,
  type SessionStreamEvent,
} from "@/lib/types"
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

function sessionErrorMessage(event: SessionStreamEvent) {
  if (event.type !== "session.error") return null
  const message = event.properties?.error?.data?.message ?? event.properties?.error?.message
  return typeof message === "string" && message.trim() ? message : "Session failed"
}

export default function SessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const { top } = useSafeAreaInsets()
  const { client, config, save } = useServer()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Record<string, FileDiff[]>>({})
  const [diffLoading, setDiffLoading] = useState<Record<string, boolean>>({})
  const [diffLoaded, setDiffLoaded] = useState<Record<string, boolean>>({})
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishTitle, setPublishTitle] = useState("")
  const [publishBody, setPublishBody] = useState("")
  const [commitMessage, setCommitMessage] = useState("")
  const [mode, setMode] = useState<"plan" | "code">("code")

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
      const nextError = sessionErrorMessage(event)
      if (nextError) {
        setError(nextError)
        return
      }

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
  const hasUserPrompt = useMemo(() => messages.some((item) => item.info.role === "user"), [messages])
  const sessionBlocked = detail?.status?.type === "busy" || detail?.status?.type === "retry"
  const cleaned = Boolean(detail?.info.github?.worktree.cleanedAt)
  const sessionLocation = detail?.info.github?.fullName || detail?.info.directory || "Unknown workspace"
  const preferredModel = useMemo(
    () => ({
      providerID: config?.modelProviderID ?? MOBILE_DEFAULT_PROVIDER_ID,
      modelID: config?.modelID ?? MOBILE_DEFAULT_MODEL_ID,
    }),
    [config?.modelID, config?.modelProviderID],
  )

  function openPublishModal() {
    if (!detail?.info.github) return
    setPublishTitle(detail.info.github.pullRequest?.title || detail.info.title)
    setCommitMessage(detail.info.title)
    setPublishBody(
      detail.info.github.pullRequest
        ? `Updated from mobile session ${detail.info.id}.`
        : `## Summary\n- Generated from mobile session \`${detail.info.id}\`\n- Base branch: \`${detail.info.github.baseBranch}\`\n- Head branch: \`${detail.info.github.headBranch}\``,
    )
    setPublishOpen(true)
  }

  async function send() {
    if (!client || !sessionId || !input.trim() || cleaned) return
    try {
      setSending(true)
      setError(null)
      const text = input.trim()
      const payload =
        mode === "plan"
          ? `Plan mode: analyze the request, propose the approach, and avoid making changes until explicitly requested.\n\nUser request: ${text}`
          : text
      await client.sendMessage(sessionId, payload, hasUserPrompt ? undefined : { model: preferredModel })
      setInput("")
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  async function loadDiff(messageID: string) {
    if (!client || !sessionId || diffLoaded[messageID] || diffLoading[messageID]) return
    try {
      setDiffLoading((current) => ({ ...current, [messageID]: true }))
      setError(null)
      const next = await client.getDiff(sessionId, messageID)
      setDiffs((current) => ({ ...current, [messageID]: next }))
      setDiffLoaded((current) => ({ ...current, [messageID]: true }))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiffLoading((current) => ({ ...current, [messageID]: false }))
    }
  }

  async function respond(permissionID: string, response: "once" | "always" | "reject") {
    if (!client || !sessionId) return
    await client.respondToPermission(sessionId, permissionID, response)
  }

  async function abort() {
    if (!client || !sessionId) return
    await client.abortSession(sessionId)
  }

  async function publish() {
    if (!client || !sessionId || !detail?.info.github || sessionBlocked || cleaned) return
    try {
      setPublishing(true)
      setError(null)
      await client.publishGithubSession(sessionId, {
        title: publishTitle.trim() || detail.info.github.pullRequest?.title || detail.info.title,
        body: publishBody.trim() || undefined,
        commitMessage: commitMessage.trim() || detail.info.title,
      })
      setPublishOpen(false)
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPublishing(false)
    }
  }

  async function cleanup() {
    if (!client || !sessionId || !detail?.info.github || sessionBlocked || cleaned) return
    try {
      setCleaning(true)
      setError(null)
      await client.cleanupGithubSession(sessionId)
      if (config && detail.info.github.repositoryDirectory) {
        await save({ ...config, directory: detail.info.github.repositoryDirectory })
      }
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setCleaning(false)
    }
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
      <View className="border-b border-border px-4 pb-3" style={{ paddingTop: top + 8 }}>
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="rounded-full border border-border bg-surface p-3">
            <ArrowLeft size={18} color="#e6eef8" strokeWidth={2.2} />
          </Pressable>
          <View className="flex-1">
            <Text className="text-base font-semibold text-ink" numberOfLines={1}>
              {detail?.info.title || "Session"}
            </Text>
            <Text className="mt-1 text-sm text-soft" numberOfLines={1}>
              {sessionLocation}
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        className="flex-1 px-4 pt-4"
        contentInsetAdjustmentBehavior="automatic"
        data={messages}
        keyExtractor={(item) => item.info.id}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            diffs={diffs[item.info.id]}
            diffLoaded={Boolean(diffLoaded[item.info.id])}
            diffLoading={Boolean(diffLoading[item.info.id])}
            onLoadDiff={loadDiff}
          />
        )}
        ListHeaderComponent={
          <>
            <SessionSummaryCard
              detail={detail}
              sessionBlocked={sessionBlocked}
              cleaned={cleaned}
              cleaning={cleaning}
              error={error}
              onPublish={openPublishModal}
              onAbort={() => void abort()}
              onCleanup={() => void cleanup()}
            />
            {detail?.permissions.length ? (
              <View className="mb-2">
                {detail.permissions.map((item) => (
                  <PermissionCard key={item.id} item={item} onRespond={(response) => void respond(item.id, response)} />
                ))}
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <EmptyState
            title="No transcript yet"
            description="Send the first instruction to start this execution timeline, stream tool activity, and capture approvals here."
          />
        }
        contentContainerStyle={{ paddingBottom: 12, paddingTop: 10 }}
      />

      <SessionComposer
        mode={mode}
        setMode={setMode}
        input={input}
        setInput={setInput}
        sending={sending}
        sessionBlocked={sessionBlocked}
        cleaned={cleaned}
        onSend={() => void send()}
      />

      <PublishSheet
        visible={publishOpen}
        detail={detail}
        publishTitle={publishTitle}
        setPublishTitle={setPublishTitle}
        publishBody={publishBody}
        setPublishBody={setPublishBody}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        publishing={publishing}
        sessionBlocked={sessionBlocked}
        cleaned={cleaned}
        onClose={() => setPublishOpen(false)}
        onPublish={() => void publish()}
      />
    </KeyboardAvoidingView>
  )
}
