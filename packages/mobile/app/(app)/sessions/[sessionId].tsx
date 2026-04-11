import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Ellipsis } from "lucide-react-native"
import * as Clipboard from "expo-clipboard"
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AdaptiveBlur } from "@/components/GlassView"
import { MessageBubble } from "@/components/MessageBubble"
import { PermissionCard } from "@/components/PermissionCard"
import { useActionSheetRef } from "@/components/BottomSheet"

import { CommandPaletteSheet, type CommandPaletteItem } from "@/components/session/CommandPaletteSheet"
import { SessionActionsSheet } from "@/components/session/SessionActionsSheet"
import { SessionComposer } from "@/components/session/SessionComposer"
import { ComposerToolbar } from "@/components/session/ComposerToolbar"
import { type ComposerTab } from "@/components/session/ComposerToolDrawer"
import { SessionRenameSheet } from "@/components/session/SessionRenameSheet"
import { PublishSheet } from "@/components/session/PublishSheet"
import { SessionSummaryCard } from "@/components/session/SessionSummaryCard"
import { GitStatusBar } from "@/components/git/GitStatusBar"
import { GitReviewModal } from "@/components/git/GitReviewModal"
import { EmptyState } from "@/components/ui/EmptyState"
import { useServer } from "@/lib/server-provider"
import { triggerHaptic } from "@/lib/haptics"
import { sendLocalNotification, stopSessionLiveActivity, upsertSessionLiveActivity } from "@/lib/notifications"
import { enqueueOp } from "@/lib/offline"
import { useUIStore } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"
import {
  type CommandInfo,
  MOBILE_DEFAULT_MODEL_ID,
  MOBILE_DEFAULT_PROVIDER_ID,
  type FileDiff,
  type GitState,
  type MessageWithParts,
  type PromptStashEntry,
  type SessionDetail,
  type SessionStreamEvent,
} from "@/lib/types"

export type PendingAttachment = {
  id: string
  mime: string
  filename: string
  base64: string
  previewUri?: string
  sizeLabel?: string
}
import { useSessionStream } from "@/hooks/use-session-stream"

function upsertMessage(messages: MessageWithParts[], next: MessageWithParts["info"]) {
  const index = messages.findIndex((item) => item.info.id === next.id)
  if (index !== -1) {
    const updated = [...messages]
    updated[index] = { ...messages[index], info: next }
    return updated
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

function parseSlashCommand(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("/")) return null
  const match = trimmed.match(/^\/([^\s]+)\s*(.*)$/s)
  if (!match) return null
  return {
    command: match[1],
    argumentsText: match[2] ?? "",
  }
}

function messagePlainText(message: MessageWithParts) {
  const text = message.parts
    .filter((part): part is Extract<MessageWithParts["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim()
  if (text) return text
  if (message.info.role === "assistant") {
    return message.info.error?.data?.message?.trim() ?? ""
  }
  return ""
}

function compactActivityText(value: string | null | undefined, limit = 72) {
  if (!value) return ""
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function buildLiveActivitySnapshot(detail: SessionDetail, input: { publishing: boolean; cleaning: boolean }) {
  const title = compactActivityText(detail.info.title || "Nikcli session", 64)

  if (input.publishing) {
    return { mode: "upsert" as const, title, subtitle: "Publishing GitHub workflow" }
  }

  if (input.cleaning) {
    return { mode: "upsert" as const, title, subtitle: "Cleaning GitHub worktree" }
  }

  if (detail.permissions.length > 0) {
    const firstPermission = compactActivityText(detail.permissions[0]?.permission || "Approval needed", 54)
    const subtitle =
      detail.permissions.length === 1
        ? `Approval needed: ${firstPermission}`
        : `${detail.permissions.length} approvals pending`

    return { mode: "upsert" as const, title, subtitle }
  }

  if (detail.status?.type === "retry") {
    return {
      mode: "upsert" as const,
      title,
      subtitle: compactActivityText(`Retry ${detail.status.attempt}: ${detail.status.message}`, 72),
      countdownTo: detail.status.next,
    }
  }

  if (detail.status?.type === "busy") {
    const workspace = compactActivityText(
      detail.info.github?.fullName || detail.info.directory || "Running session",
      72,
    )
    return { mode: "upsert" as const, title, subtitle: workspace }
  }

  if (detail.status?.type === "idle") {
    const subtitle = detail.info.github?.pullRequest ? "GitHub work ready" : "Ready for next command"
    return { mode: "stop" as const, title, subtitle }
  }

  return null
}

export default function SessionScreen() {
  const { palette, isDark } = useAppTheme()
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const { top } = useSafeAreaInsets()
  const { client, config, save } = useServer()
  const composerPreferences = useUIStore((state) => state.composer)
  const promptPresets = useUIStore((state) => state.promptPresets)
  const listRef = useRef<FlatList<MessageWithParts>>(null)
  const statusRef = useRef<SessionDetail["status"]>()
  const permissionIDsRef = useRef<Set<string>>(new Set())
  const followTranscriptRef = useRef(true)
  const initialScrollDoneRef = useRef(false)
  const scrollRafRef = useRef<number | null>(null)
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
  const [mode, setMode] = useState<"plan" | "code">(composerPreferences.defaultMode)
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [stashEntries, setStashEntries] = useState<PromptStashEntry[]>([])
  const [commandsLoading, setCommandsLoading] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState("")
  const chromeButtonFill = isDark ? "rgba(22,22,22,0.88)" : "rgba(255,255,255,0.88)"
  const chromeButtonOverlay = isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.16)"
  const chromeButtonStyle = {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.82)",
    overflow: "hidden",
    padding: 12,
  } as const
  const [activeMessageID, setActiveMessageID] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [gitState, setGitState] = useState<GitState | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitReviewOpen, setGitReviewOpen] = useState(false)
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; badge?: string }>>([])
  const [mcpServers, setMcpServers] = useState<Array<{ name: string; connected: boolean; enabled: boolean }>>([])
  const actionsSheetRef = useActionSheetRef()

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

  const loadCommands = useCallback(async () => {
    if (!client || !sessionId) {
      setCommands([])
      return
    }

    try {
      setCommandsLoading(true)
      setCommands(await client.listCommands(sessionId))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setCommandsLoading(false)
    }
  }, [client, sessionId])

  const loadMemories = useCallback(async () => {
    if (!client) {
      setStashEntries([])
      return
    }

    try {
      setStashEntries(await client.listPromptStash())
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [client])

  const loadGitState = useCallback(async () => {
    if (!client) {
      setGitState(null)
      return
    }

    try {
      setGitLoading(true)
      const state = await client.getGitStatus()
      setGitState(state)
    } catch (error) {
      console.warn("Failed to load git state:", error)
      setGitState(null)
    } finally {
      setGitLoading(false)
    }
  }, [client])

  const loadPlugins = useCallback(async () => {
    if (!client) {
      setMcpServers([])
      return
    }

    try {
      const [hostConfig, mcpStatus] = await Promise.all([
        client.getConfig(),
        client.listMcpStatus(),
      ])

      const servers = Object.entries(hostConfig?.mcp ?? {}).map(([name, cfg]) => ({
        name,
        enabled: cfg.enabled !== false,
        connected: mcpStatus[name]?.status === "connected",
      }))
      setMcpServers(servers)
    } catch (error) {
      console.warn("Failed to load plugins:", error)
    }
  }, [client])

  const drawerSkills = useMemo(
    () => commands.filter((c) => c.skill).map((c) => ({ name: c.name, description: c.description })),
    [commands],
  )

  const drawerTools = useMemo(
    () =>
      commands
        .filter((c) => !c.skill && !c.mcp && !c.subtask)
        .map((c) => ({ name: c.name, description: c.description, enabled: true })),
    [commands],
  )

  const loadAvailableModels = useCallback(async () => {
    if (!client) return
    try {
      const providers = await client.listProviders()
      const connectedSet = new Set(providers.connected)
      const models = providers.all
        .filter((p) => connectedSet.has(p.id))
        .flatMap((p) =>
          Object.values(p.models).map((m) => ({
            id: `${p.id}/${m.id}`,
            name: `${p.name} — ${m.name}`,
            badge: m.id === providers.default[p.id] ? "Default" : undefined,
          })),
        )
      setAvailableModels(models)
    } catch (error) {
      console.warn("Failed to load models:", error)
      setAvailableModels([])
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
      void loadCommands()
      void loadMemories()
      void loadGitState()
      void loadPlugins()
      void loadAvailableModels()
    }, [load, loadCommands, loadMemories, loadGitState, loadPlugins, loadAvailableModels]),
  )

  useEffect(() => {
    if (!commandPaletteOpen) return
    void loadCommands()
    void loadMemories()
  }, [commandPaletteOpen, loadCommands, loadMemories])

  useEffect(() => {
    followTranscriptRef.current = composerPreferences.autoFollowTranscript
    initialScrollDoneRef.current = false
  }, [composerPreferences.autoFollowTranscript, sessionId])

  useEffect(() => {
    setMode(composerPreferences.defaultMode)
  }, [composerPreferences.defaultMode, sessionId])

  useEffect(() => {
    if (!detail) return
    statusRef.current = detail.status
    permissionIDsRef.current = new Set(detail.permissions.map((item) => item.id))
  }, [detail])

  useSessionStream({
    config,
    sessionID: sessionId,
    enabled: Boolean(config && sessionId),
    onEvent(event: SessionStreamEvent) {
      const nextError = sessionErrorMessage(event)
      if (nextError) {
        setError(nextError)
        void triggerHaptic("error")
        if (sessionId) {
          void stopSessionLiveActivity({
            sessionID: sessionId,
            title: detail?.info.title || "Session failed",
            subtitle: compactActivityText(nextError, 72),
          })
        }
        void sendLocalNotification({
          kind: "failures",
          title: detail?.info.title || "Session failed",
          body: nextError,
          dedupeKey: `${sessionId}:error:${nextError}`,
          href: sessionId ? `/sessions/${sessionId}` : undefined,
          sessionID: sessionId,
        })
        return
      }

      if (event.type === "permission.asked") {
        const requestID = event.properties.id
        if (!permissionIDsRef.current.has(requestID)) {
          permissionIDsRef.current.add(requestID)
          void triggerHaptic("permission")
          void sendLocalNotification({
            kind: "permissions",
            title: detail?.info.title || "Permission required",
            body: event.properties.permission,
            dedupeKey: `${sessionId}:permission:${requestID}`,
            href: sessionId ? `/sessions/${sessionId}` : undefined,
            sessionID: sessionId,
          })
        }
      }

      if (event.type === "permission.replied") {
        permissionIDsRef.current.delete(event.properties.requestID)
      }

      if (event.type === "session.status") {
        statusRef.current = event.properties.status
      }

      if (event.type === "session.idle") {
        if (statusRef.current?.type && statusRef.current.type !== "idle") {
          void triggerHaptic("success")
          void sendLocalNotification({
            kind: "sessionReady",
            title: detail?.info.title || "Session ready",
            body: "Execution is idle and ready for the next command.",
            dedupeKey: `${sessionId}:idle`,
            href: sessionId ? `/sessions/${sessionId}` : undefined,
            sessionID: sessionId,
          })
        }
        statusRef.current = { type: "idle" }
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
  const liveActivitySnapshot = useMemo(
    () => (detail && sessionId ? buildLiveActivitySnapshot(detail, { publishing, cleaning }) : null),
    [cleaning, detail, publishing, sessionId],
  )
  const preferredModel = useMemo(
    () => ({
      providerID: config?.modelProviderID ?? MOBILE_DEFAULT_PROVIDER_ID,
      modelID: config?.modelID ?? MOBILE_DEFAULT_MODEL_ID,
    }),
    [config?.modelID, config?.modelProviderID],
  )

  useEffect(() => {
    if (!sessionId || !liveActivitySnapshot) return

    if (liveActivitySnapshot.mode === "upsert") {
      void upsertSessionLiveActivity({
        sessionID: sessionId,
        title: liveActivitySnapshot.title,
        subtitle: liveActivitySnapshot.subtitle,
        countdownTo: liveActivitySnapshot.countdownTo,
      })
      return
    }

    void stopSessionLiveActivity({
      sessionID: sessionId,
      title: liveActivitySnapshot.title,
      subtitle: liveActivitySnapshot.subtitle,
    })
  }, [liveActivitySnapshot, sessionId])
  const modelLabel = useMemo(() => {
    const id = config?.modelID ?? MOBILE_DEFAULT_MODEL_ID
    return id.split(/[-/]/).pop() ?? id
  }, [config?.modelID])
  const slashInput = useMemo(() => parseSlashCommand(input), [input])
  const slashSuggestions = useMemo(() => {
    if (!composerPreferences.slashSuggestions) return []
    if (!input.trimStart().startsWith("/")) return []
    const raw = input.trimStart().slice(1).split(/\s+/)[0]?.toLowerCase() ?? ""
    return commands
      .filter((command) => {
        if (!raw) return true
        return (
          command.name.toLowerCase().includes(raw) ||
          command.description?.toLowerCase().includes(raw) ||
          command.hints.some((hint) => hint.toLowerCase().includes(raw))
        )
      })
      .slice(0, 5)
      .map((command) => ({
        name: command.name,
        description: command.description,
        badge: command.skill
          ? "Skill"
          : command.mcp
            ? "MCP"
            : command.subtask
              ? "Task"
              : command.hints.length
                ? `${command.hints.length} args`
                : undefined,
      }))
  }, [commands, composerPreferences.slashSuggestions, input])
  const activeMcpCount = useMemo(() => commands.filter((c) => c.mcp).length, [commands])

  async function handleRename(title: string) {
    if (!client || !sessionId) return
    try {
      setRenaming(true)
      await client.renameSession(sessionId, title)
      await load()
      setRenameOpen(false)
      void triggerHaptic("success")
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setRenaming(false)
    }
  }

  async function handleExport(format: "markdown" | "json") {
    if (!detail) return
    const messages = detail.messages
    let content: string
    let title: string
    if (format === "json") {
      content = JSON.stringify(detail, null, 2)
      title = `${detail.info.title}.json`
    } else {
      const lines: string[] = [`# ${detail.info.title}`, ""]
      for (const msg of messages) {
        const role = msg.info.role === "user" ? "**User**" : "**Assistant**"
        const text = msg.parts
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n\n")
        if (text) lines.push(`${role}\n\n${text}`, "")
      }
      content = lines.join("\n")
      title = `${detail.info.title}.md`
    }
    await Share.share({ message: content, title })
    void triggerHaptic("success")
  }

  function handleAddAttachment(item: PendingAttachment) {
    void triggerHaptic("selection")
    setPendingAttachments((prev) => [...prev, item])
  }

  function handleRemoveAttachment(id: string) {
    void triggerHaptic("selection")
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }

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
      if (slashInput) {
        await client.sendCommand(sessionId, slashInput.command, slashInput.argumentsText, {
          model: hasUserPrompt ? undefined : preferredModel,
        })
        void triggerHaptic("command")
        setInput("")
        return
      }
      const text = input.trim()
      const payload =
        mode === "plan"
          ? `Plan mode: analyze the request, propose the approach, and avoid making changes until explicitly requested.\n\nUser request: ${text}`
          : text
      if (pendingAttachments.length > 0) {
        const fileParts = pendingAttachments.map((a) => ({
          type: "file" as const,
          mime: a.mime,
          filename: a.filename,
          url: `data:${a.mime};base64,${a.base64}`,
        }))
        await client.sendParts(
          sessionId,
          [{ type: "text", text: payload }, ...fileParts],
          hasUserPrompt ? undefined : { model: preferredModel },
        )
        setPendingAttachments([])
      } else {
        await client.sendMessage(sessionId, payload, hasUserPrompt ? undefined : { model: preferredModel })
      }
      void triggerHaptic("send")
      setInput("")
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      void triggerHaptic("error")
      // Queue for offline delivery on next foreground
      if (sessionId && input.trim() && !slashInput) {
        void enqueueOp({ type: "sendMessage", sessionID: sessionId, text: input.trim() })
      }
    } finally {
      setSending(false)
    }
  }

  function insertSlashCommand(name: string) {
    void triggerHaptic("selection")
    const current = input.trimStart()
    const match = current.match(/^\/([^\s]+)(.*)$/s)
    const remainder = match?.[2] ?? ""
    const nextRemainder = remainder.startsWith(" ") || remainder === "" ? remainder : ` ${remainder}`
    setInput(`/${name}${nextRemainder || " "}`)
  }

  function scrollToTop() {
    followTranscriptRef.current = false
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }

  function scrollToBottom() {
    followTranscriptRef.current = true
    listRef.current?.scrollToEnd({ animated: true })
  }

  function mergeDraft(nextValue: string) {
    const current = input.trim()
    if (current.startsWith("/")) {
      setInput(nextValue)
      return
    }
    if (!current) {
      setInput(nextValue)
      return
    }
    setInput(`${current}\n\n${nextValue}`)
  }

  function scrollToLatest(animated: boolean) {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current)
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      listRef.current?.scrollToEnd({ animated })
    })
  }

  function updateTranscriptFollow(event: {
    nativeEvent: {
      layoutMeasurement: { height: number }
      contentOffset: { y: number }
      contentSize: { height: number }
    }
  }) {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y)
    followTranscriptRef.current = distanceFromBottom < 96
  }

  async function copyMessage(message: MessageWithParts) {
    const value = messagePlainText(message)
    if (!value) return
    await Clipboard.setStringAsync(value)
    setActiveMessageID(null)
    void triggerHaptic("selection")
  }

  function reuseMessage(message: MessageWithParts) {
    const value = messagePlainText(message)
    if (!value) return
    setInput(message.info.role === "assistant" ? `Follow up on this result:\n\n${value}` : value)
    setActiveMessageID(null)
    void triggerHaptic("selection")
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
    void triggerHaptic(response === "reject" ? "error" : "success")
  }

  async function abort() {
    if (!client || !sessionId) return
    await client.abortSession(sessionId)
    void triggerHaptic("error")
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
      void triggerHaptic("success")
      void sendLocalNotification({
        kind: "sessionReady",
        title: detail.info.title,
        body: "GitHub publish workflow completed successfully.",
        dedupeKey: `${sessionId}:publish`,
        href: `/sessions/${sessionId}`,
        sessionID: sessionId,
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
      void triggerHaptic("success")
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

  const paletteItems = useMemo<CommandPaletteItem[]>(() => {
    const localItems: CommandPaletteItem[] = [
      {
        id: "local.scroll.bottom",
        title: "Jump to latest output",
        description: "Scroll to the newest message in this transcript.",
        section: "View",
        badge: "Local",
        keywords: ["bottom", "latest", "newest", "transcript"],
        onPress: () => {
          setCommandPaletteOpen(false)
          void triggerHaptic("selection")
          scrollToBottom()
        },
      },
      {
        id: "local.scroll.permissions",
        title: "Jump to approvals",
        description: "Scroll to the top of the session and inspect pending permissions.",
        section: "View",
        badge: detail?.permissions.length ? `${detail.permissions.length}` : "Local",
        disabled: !detail?.permissions.length,
        keywords: ["permissions", "approvals", "top"],
        onPress: () => {
          setCommandPaletteOpen(false)
          void triggerHaptic("selection")
          scrollToTop()
        },
      },
      {
        id: "local.publish",
        title: "Open publish workflow",
        description: "Prepare commit, PR title, and publish notes for the current GitHub session.",
        section: "GitHub",
        badge: "Local",
        disabled: !detail?.info.github || cleaned,
        keywords: ["publish", "pull request", "pr", "commit"],
        onPress: () => {
          setCommandPaletteOpen(false)
          void triggerHaptic("selection")
          openPublishModal()
        },
      },
      {
        id: "local.abort",
        title: "Abort active run",
        description: "Stop the current execution if the session is busy.",
        section: "Session",
        badge: "Local",
        disabled: !sessionBlocked,
        keywords: ["abort", "stop", "cancel", "busy"],
        onPress: () => {
          setCommandPaletteOpen(false)
          void abort()
        },
      },
      {
        id: "local.clear",
        title: "Clear composer",
        description: "Remove the current draft from the composer.",
        section: "Compose",
        badge: "Local",
        disabled: !input.trim(),
        keywords: ["clear", "draft", "composer"],
        onPress: () => {
          setCommandPaletteOpen(false)
          void triggerHaptic("selection")
          setInput("")
        },
      },
      {
        id: "local.save-snippet",
        title: "Save draft to memories",
        description: "Store the current composer draft as a reusable host-backed snippet.",
        section: "Memories",
        badge: "Local",
        disabled: !input.trim(),
        keywords: ["save", "snippet", "memory", "stash", "draft"],
        onPress: () => {
          setCommandPaletteOpen(false)
          if (!client || !input.trim()) return
          void (async () => {
            try {
              await client.addPromptStash({ input: input.trim() })
              await loadMemories()
              void triggerHaptic("success")
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error))
              void triggerHaptic("error")
            }
          })()
        },
      },
    ]

    const presetItems = promptPresets.map<CommandPaletteItem>((preset) => ({
      id: `preset:${preset.id}`,
      title: preset.title,
      description: preset.prompt,
      section: "Presets",
      badge: preset.mode,
      keywords: [preset.mode, "preset", "prompt"],
      onPress: () => {
        setCommandPaletteOpen(false)
        setMode(preset.mode)
        mergeDraft(preset.prompt)
        void triggerHaptic("selection")
      },
    }))

    const stashItems = stashEntries.slice(0, 8).map<CommandPaletteItem>((entry) => ({
      id: `stash:${entry.id}`,
      title: `Snippet ${new Date(entry.timestamp).toLocaleDateString()}`,
      description: entry.input,
      section: "Memories",
      badge: entry.partsCount ? `${entry.partsCount} parts` : "Snippet",
      keywords: ["memory", "snippet", "stash"],
      onPress: () => {
        setCommandPaletteOpen(false)
        mergeDraft(entry.input)
        void triggerHaptic("selection")
      },
    }))

    const serverItems = commands.map<CommandPaletteItem>((command) => ({
      id: `command:${command.name}`,
      title: `/${command.name}`,
      description:
        command.description ||
        (command.hints.length
          ? `Arguments: ${command.hints.join(", ")}`
          : "Insert this slash command into the composer."),
      section: command.skill ? "Skills" : command.mcp ? "MCP" : command.subtask ? "Subtasks" : "Commands",
      badge: command.skill
        ? "Skill"
        : command.mcp
          ? "MCP"
          : command.subtask
            ? "Task"
            : command.hints.length
              ? `${command.hints.length} args`
              : undefined,
      keywords: command.skill ? [...command.hints, "skill"] : command.hints,
      onPress: () => {
        setCommandPaletteOpen(false)
        insertSlashCommand(command.name)
      },
    }))

    const items = [...localItems, ...presetItems, ...stashItems, ...serverItems]
    const term = commandQuery.trim().toLowerCase()
    if (!term) return items

    return items.filter((item) => {
      const haystack = [item.title, item.description ?? "", item.section, item.badge ?? "", ...(item.keywords ?? [])]
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [
    abort,
    client,
    commandQuery,
    commands,
    detail?.info.github,
    detail?.permissions.length,
    input,
    loadMemories,
    promptPresets,
    sessionBlocked,
    stashEntries,
  ])

  if (loading && !detail) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={palette.accent} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View className="border-b border-border px-4 pb-3" style={{ paddingTop: top + 8 }}>
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} style={chromeButtonStyle}>
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={44}
              style={StyleSheet.absoluteFill}
              fallbackColor={chromeButtonFill}
              pointerEvents="none"
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: chromeButtonOverlay }]} pointerEvents="none" />
            <ArrowLeft size={18} color={palette.ink} strokeWidth={2.2} />
          </Pressable>
          <View className="flex-1">
            <Text className="text-base font-semibold text-ink" numberOfLines={1}>
              {detail?.info.title || "Session"}
            </Text>
            <Text className="mt-1 text-sm text-soft" numberOfLines={1}>
              {sessionLocation}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              void triggerHaptic("selection")
              actionsSheetRef.current?.present()
            }}
            style={chromeButtonStyle}
          >
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={44}
              style={StyleSheet.absoluteFill}
              fallbackColor={chromeButtonFill}
              pointerEvents="none"
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: chromeButtonOverlay }]} pointerEvents="none" />
            <Ellipsis size={18} color={palette.ink} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>

      <FlatList
        ref={listRef}
        className="flex-1 px-4 pt-4"
        contentInsetAdjustmentBehavior="automatic"
        onLayout={() => {
          if (detail && !initialScrollDoneRef.current) {
            initialScrollDoneRef.current = true
            scrollToLatest(false)
          }
        }}
        onContentSizeChange={() => {
          if (!detail) return
          if (!initialScrollDoneRef.current) {
            initialScrollDoneRef.current = true
            scrollToLatest(false)
            return
          }
          if (followTranscriptRef.current) {
            scrollToLatest(!sessionBlocked)
          }
        }}
        onScroll={updateTranscriptFollow}
        scrollEventThrottle={16}
        data={messages}
        keyExtractor={(item) => item.info.id}
        renderItem={({ item }) => {
          const messageText = messagePlainText(item)
          const hasReusableText = Boolean(messageText)

          return (
            <MessageBubble
              message={item}
              diffs={diffs[item.info.id]}
              diffLoaded={Boolean(diffLoaded[item.info.id])}
              diffLoading={Boolean(diffLoading[item.info.id])}
              onLoadDiff={loadDiff}
              isActive={activeMessageID === item.info.id}
              onCopy={hasReusableText ? () => void copyMessage(item) : undefined}
              onFork={hasReusableText ? () => reuseMessage(item) : undefined}
              onDismiss={() => setActiveMessageID(null)}
              onActivate={() => setActiveMessageID(item.info.id)}
            />
          )
        }}
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
        contentContainerStyle={{ paddingBottom: 16, paddingTop: 10 }}
      />

      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        {detail?.info.github && (
          <GitStatusBar
            gitState={gitState}
            loading={gitLoading}
            onPress={() => setGitReviewOpen(true)}
            onRefresh={() => void loadGitState()}
          />
        )}
      </View>

      <ComposerToolbar
        onAttach={() => void triggerHaptic("selection")}
        onGitPress={() => setGitReviewOpen(true)}
        onModelSelect={(id) => {
          if (!client || id === "default") return
          void (async () => {
            try {
              const [providerID, modelID] = id.split("/")
              await client.updateConfig({ modelID, modelProviderID: providerID })
              void triggerHaptic("selection")
            } catch (error) {
              console.warn("Failed to update model:", error)
              void triggerHaptic("error")
            }
          })()
        }}
        onMcpToggle={(name, enabled) => {
          if (!client) return
          void (async () => {
            try {
              await client.toggleMcp(name, enabled)
              await loadPlugins()
              void triggerHaptic("selection")
            } catch (error) {
              console.warn("Failed to toggle MCP:", error)
              void triggerHaptic("error")
            }
          })()
        }}
        modelLabel={modelLabel}
        availableModels={availableModels}
        mcpServers={mcpServers}
        skills={drawerSkills}
        tools={drawerTools}
        onSkillSelect={insertSlashCommand}
        onToolSelect={insertSlashCommand}
      />

      <SessionComposer
        mode={mode}
        setMode={setMode}
        input={input}
        setInput={setInput}
        slashSuggestions={slashSuggestions}
        slashLoading={commandsLoading}
        sending={sending}
        sessionBlocked={sessionBlocked}
        cleaned={cleaned}
        onOpenCommands={() => setCommandPaletteOpen(true)}
        onSelectSlash={insertSlashCommand}
        onSend={() => void send()}
        onStop={() => void abort()}
        pendingAttachments={pendingAttachments}
        onAddAttachment={handleAddAttachment}
        onRemoveAttachment={handleRemoveAttachment}
        modelLabel={modelLabel}
        activeMcpCount={activeMcpCount}
      />

      <CommandPaletteSheet
        visible={commandPaletteOpen}
        loading={commandsLoading}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        onClose={() => setCommandPaletteOpen(false)}
        items={paletteItems}
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

      <SessionActionsSheet
        sheetRef={actionsSheetRef}
        title={detail?.info.title ?? ""}
        onRename={() => {
          actionsSheetRef.current?.dismiss()
          setTimeout(() => setRenameOpen(true), 220)
        }}
        onExportMarkdown={() => {
          actionsSheetRef.current?.dismiss()
          void handleExport("markdown")
        }}
        onExportJSON={() => {
          actionsSheetRef.current?.dismiss()
          void handleExport("json")
        }}
        onCopyID={() => {
          actionsSheetRef.current?.dismiss()
          if (sessionId) void Clipboard.setStringAsync(sessionId)
          void triggerHaptic("selection")
        }}
      />

      <SessionRenameSheet
        visible={renameOpen}
        currentTitle={detail?.info.title ?? ""}
        saving={renaming}
        onClose={() => setRenameOpen(false)}
        onSave={(title) => void handleRename(title)}
      />

      <GitReviewModal
        visible={gitReviewOpen}
        onClose={() => setGitReviewOpen(false)}
        sessionID={sessionId ?? ""}
        github={
          detail?.info.github
            ? {
                owner: detail.info.github.owner,
                repo: detail.info.github.repo,
                baseBranch: detail.info.github.baseBranch,
                headBranch: detail.info.github.headBranch,
                pullRequest: detail.info.github.pullRequest,
              }
            : undefined
        }
        onCommit={async (message, files) => {
          if (!client) return
          await client.createGitCommit(message, files)
        }}
        onPublish={openPublishModal}
      />
    </KeyboardAvoidingView>
  )
}
