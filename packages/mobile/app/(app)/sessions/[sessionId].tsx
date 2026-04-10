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
import { AttachmentPicker } from "@/components/session/AttachmentPicker"
import { CommandPaletteSheet, type CommandPaletteItem } from "@/components/session/CommandPaletteSheet"
import { SessionActionsSheet } from "@/components/session/SessionActionsSheet"
import { SessionComposer } from "@/components/session/SessionComposer"
import { SessionRenameSheet } from "@/components/session/SessionRenameSheet"
import { PublishSheet } from "@/components/session/PublishSheet"
import { SessionSummaryCard } from "@/components/session/SessionSummaryCard"
import { EmptyState } from "@/components/ui/EmptyState"
import { useServer } from "@/lib/server-provider"
import { triggerHaptic } from "@/lib/haptics"
import { sendLocalNotification } from "@/lib/notifications"
import { enqueueOp } from "@/lib/offline"
import { useUIStore } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"
import {
  type CommandInfo,
  MOBILE_DEFAULT_MODEL_ID,
  MOBILE_DEFAULT_PROVIDER_ID,
  type FileDiff,
  type MessageWithParts,
  type PromptStashEntry,
  type SessionDetail,
  type SessionStreamEvent,
} from "@/lib/types"
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
  const [attachPickerOpen, setAttachPickerOpen] = useState(false)
  const actionsSheetRef = useActionSheetRef()
  const attachSheetRef = useActionSheetRef()

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

  useFocusEffect(
    useCallback(() => {
      void load()
      void loadCommands()
      void loadMemories()
    }, [load, loadCommands, loadMemories]),
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
  }, [detail?.permissions, detail?.status])

  useSessionStream({
    config,
    sessionID: sessionId,
    enabled: Boolean(config && sessionId),
    onEvent(event: SessionStreamEvent) {
      const nextError = sessionErrorMessage(event)
      if (nextError) {
        setError(nextError)
        void triggerHaptic("error")
        void sendLocalNotification({
          kind: "failures",
          title: detail?.info.title || "Session failed",
          body: nextError,
          dedupeKey: `${sessionId}:error:${nextError}`,
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
  const preferredModel = useMemo(
    () => ({
      providerID: config?.modelProviderID ?? MOBILE_DEFAULT_PROVIDER_ID,
      modelID: config?.modelID ?? MOBILE_DEFAULT_MODEL_ID,
    }),
    [config?.modelID, config?.modelProviderID],
  )
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

  function handleAttach() {
    attachSheetRef.current?.present()
  }

  async function handleAttachFile(mime: string, filename: string, base64: string) {
    if (!client || !sessionId || cleaned) return
    try {
      setSending(true)
      setError(null)
      await client.sendParts(sessionId, [{ type: "file", mime, filename, url: `data:${mime};base64,${base64}` }])
      void triggerHaptic("send")
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      void triggerHaptic("error")
    } finally {
      setSending(false)
    }
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
      await client.sendMessage(sessionId, payload, hasUserPrompt ? undefined : { model: preferredModel })
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
        contentContainerStyle={{ paddingBottom: 100, paddingTop: 10 }}
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
        onOpenCommands={() => {
          setCommandQuery("")
          setCommandPaletteOpen(true)
        }}
        onSelectSlash={insertSlashCommand}
        onSend={() => void send()}
        onAttach={handleAttach}
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

      <AttachmentPicker
        sheetRef={attachSheetRef}
        onFile={(mime, filename, base64) => void handleAttachFile(mime, filename, base64)}
      />
    </KeyboardAvoidingView>
  )
}
