import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useTheme, selectedForeground, tint } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
  TextAttributes,
  RGBA,
} from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import {
  createNikcliClient,
  type AssistantMessage,
  type Part,
  type ToolPart,
  type UserMessage,
  type TextPart,
  type ReasoningPart,
} from "@nikcli-ai/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import { reasoningSummary } from "@tui/context/thinking"
import { Token } from "@/util/token"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import type { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import type { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import type { MonitorTool } from "@/tool/monitor"
import type { QuestionTool } from "@/tool/question"
import type { BrowserTool } from "@/tool/browser"
import type { ComputerTool } from "@/tool/computer"
import type { ArtifactTool } from "@/tool/artifact"

import { normalizeVizComponents, type OpenTUIVizTool } from "@/tool/opentui"
import type { LSP } from "@/lsp"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { useServer } from "../../context/server"
import { Editor } from "../../util/editor"
import stripAnsi from "strip-ansi"
import { SubagentFooter } from "./subagent-footer.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript } from "../../util/transcript"
import { TurnUsage } from "../../util/turn-usage"
import { DialogWebPreview } from "@tui/component/dialog-web-preview"
import { DialogOpenTUIViz, Renderer as VizRenderer } from "@tui/component/dialog-opentui-viz"
import { compilePartialSpec } from "@tui/util/spec-stream"
import { TuiImageList } from "@tui/component/tui-image"
import { DialogSelect } from "../../ui/dialog-select"
import { DialogBgAgents } from "./dialog-bg-agents"
import { features } from "@/config/features"
import { useLanguage } from "@tui/context/language"
import { spacerHeights, visibleRange } from "./message-window"
import { groupLabel, groupParts, type ExplorationGroup } from "./rows"
import { RevertBanner } from "./revert-banner"
import { sessionCommandLabels } from "./session-command-labels"
import {
  dismissBackground as dismissBackgroundUtil,
  getBackgroundDismissed,
  undismissBackground as undismissBackgroundUtil,
} from "../../util/background"
import { friendlyErrorMessage } from "../../util/error-message"
import { Link } from "../../ui/link"

addDefaultParsers(parsers.parsers)

function shareErrorMessage(error: unknown) {
  return friendlyErrorMessage(error, "Failed to share session")
}

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  diffWrapMode: () => "word" | "none"
  messageCreatedAt: () => Record<string, number>
  sync: ReturnType<typeof useSync>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const server = useServer()
  const { theme } = useTheme()
  const lang = useLanguage()
  const commandLabels = sessionCommandLabels(lang)
  const promptRef = usePromptRef()
  // Refs and reactive primitives that are referenced from earlier `createEffect` /
  // `createMemo` callbacks. Must be declared before any usage site to avoid TDZ
  // errors when effects run before JSX `ref={(r) => …}` callbacks.
  const dimensions = useTerminalDimensions()
  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  let lastSwitch: string | undefined = undefined
  const session = createMemo(() => sync.session.get(route.sessionID))
  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const backgroundWorkerChildren = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    if (!parentID) return []
    const workerIDs = new Set(
      sync.background
        .list(parentID)
        .map((job) => job.workerSessionID)
        .filter((id): id is string => Boolean(id)),
    )
    return sync.data.session.filter((x) => workerIDs.has(x.id)).toSorted((a, b) => a.time.created - b.time.created)
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  /**
   * Per-turn token rows, keyed by the assistant message that ends the turn.
   * Computed once here rather than per row: each turn needs the steps before it,
   * so deriving it inside the message component would be quadratic over a long
   * session. Empty (and free) unless the `turn_tokens` TUI option is on.
   */
  const turnUsage = createMemo(() =>
    sync.data.config.tui?.turn_tokens === true ? TurnUsage.byMessage(messages()) : undefined,
  )
  // The virtualizer uses estimated heights. While the assistant is streaming,
  // the active row grows on every text delta, so those estimates no longer
  // describe the scroll position and can window the live response out.
  const streaming = createMemo(() => messages().some((x) => x.role === "assistant" && !x.time.completed))
  /** Estimated row height per message for windowing (refined later from measured heights). */
  const MESSAGE_HEIGHT_ESTIMATE = 6
  const OVERSCAN = 5
  const virtualizationEnabled = createMemo(() => features(sync.data.config).tui.messageVirtualization)
  const [scrollPos, setScrollPos] = createSignal(0)
  const [viewportH, setViewportH] = createSignal(24)
  createEffect(() => {
    if (!virtualizationEnabled()) return
    const id = setInterval(() => {
      if (!scroll) return
      const y = typeof (scroll as { scrollTop?: number }).scrollTop === "number" ? (scroll as any).scrollTop : scroll.y
      setScrollPos(typeof y === "number" ? y : 0)
      const h = typeof scroll.height === "number" ? scroll.height : dimensions().height - 10
      setViewportH(Math.max(1, h))
    }, 50)
    onCleanup(() => clearInterval(id))
  })
  /**
   * Windowed message list for C1 virtualization. Flag off → full list (bit-identical).
   * On any error → full list fallback.
   */
  const windowed = createMemo(() => {
    const all = messages()
    if (!virtualizationEnabled() || streaming() || all.length === 0) {
      return { items: all, top: 0, bottom: 0, baseIndex: 0 }
    }
    try {
      const heights = all.map(() => MESSAGE_HEIGHT_ESTIMATE)
      const scrollTop = scrollPos()
      const vp = viewportH()
      // Sticky-bottom is owned by the scrollbox itself (stickyScroll=true,
      // stickyStart="bottom"). Do NOT clamp scrollTop here — double-sticky
      // causes jumpy viewport during streaming when the flag is on.
      const range = visibleRange({
        heights,
        scrollTop,
        viewportHeight: vp,
        overscan: OVERSCAN,
      })
      const spacers = spacerHeights(heights, range)
      return {
        items: all.slice(range.start, range.end),
        top: spacers.top,
        bottom: spacers.bottom,
        baseIndex: range.start,
      }
    } catch {
      return { items: all, top: 0, bottom: 0, baseIndex: 0 }
    }
  })
  const messageCreatedAt = createMemo(() =>
    Object.fromEntries(messages().map((message) => [message.id, message.time.created])),
  )
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")
  const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", true)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(3)
  })
  const toast = useToast()
  const sdk = useSDK()
  const project = useProject()

  createEffect(async () => {
    const sessionID = route.sessionID
    // Opencode parity: opening a session that belongs to a different
    // workspace switches the TUI's current workspace and re-bootstraps the
    // scoped data (path/vcs/config/sessions) so the whole UI reflects the
    // worktree (branch, directory, ...) instead of the root checkout.
    const workspaceID = route.workspaceID ?? untrack(() => sync.session.get(sessionID)?.workspaceID)
    const previousWorkspace = untrack(() => project.workspace.current())
    if (workspaceID !== previousWorkspace) {
      project.workspace.set(workspaceID)
      try {
        await sync.bootstrap()
      } catch {}
    }
    if (route.sessionID !== sessionID) return
    await sync.session
      .sync(sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch(() => {
        toast.show({
          message: `Session not found: ${sessionID}`,
          variant: "error",
        })
        return navigate({
          type: "home",
          workspaceID: sync.session.get(sessionID)?.workspaceID,
        })
      })
  })

  // Handle initial prompt from fork
  createEffect(
    on(
      () => route.initialPrompt,
      (initialPrompt) => {
        if (initialPrompt && prompt) {
          prompt.set(initialPrompt)
        }
      },
      { defer: true },
    ),
  )

  onMount(() => {
    const autoBackgroundedTasks = new Set<string>()
    const off = sdk.event.on("message.part.updated", (evt) => {
      const part = evt.properties.part
      if (part.type !== "tool") return

      // Auto-background: handle task parts for ANY session that is a known
      // parent (not just the currently active route) so events aren't lost
      // when the user navigates away during background task startup.
      if (part.tool === "task") {
        const metadata = (part.state as any)?.metadata
        const backgroundID = metadata?.rootDelegationId ?? metadata?.delegationId ?? part.id
        const parentID = part.sessionID
        if (metadata?.background === true && !autoBackgroundedTasks.has(backgroundID)) {
          autoBackgroundedTasks.add(backgroundID)
          undismissBackground(parentID, backgroundID)
          void sync.background.sync(parentID)
        }
        return
      }

      // plan_enter/plan_exit only matter for the currently active session
      if (part.sessionID !== route.sessionID) return
      if (part.state.status !== "completed") return
      if (part.id === lastSwitch) return

      if (part.tool === "plan_exit") {
        local.agent.set("build")
        lastSwitch = part.id
      } else if (part.tool === "plan_enter") {
        local.agent.set("plan")
        lastSwitch = part.id
      }
    })

    onCleanup(() => off())
  })

  const keybind = useKeybind()
  const status = createMemo(() => sync.data.session_status?.[route.sessionID] ?? { type: "idle" as const })

  const getDismissed = (parentID: string) => getBackgroundDismissed(kv, parentID)
  const dismissBackground = (parentID: string, delegationID: string) =>
    dismissBackgroundUtil(kv, parentID, delegationID)
  const undismissBackground = (parentID: string, delegationID: string) =>
    undismissBackgroundUtil(kv, parentID, delegationID)

  // Allow exit when in child session (prompt is hidden)
  const { exit } = useExit()
  useKeyboard((evt) => {
    if (!session()?.parentID) return
    if (keybind.match("app_exit", evt)) {
      exit()
    }
  })

  useKeyboard((evt) => {
    const parentID = session()?.parentID
    if (!parentID) return
    if (!keybind.match("subtask_background", evt)) return

    evt.preventDefault()
    evt.stopPropagation()
    const job = sync.background.findBySession(route.sessionID)
    if (job) undismissBackground(parentID, job.rootDelegationID)
    navigate({
      type: "session",
      sessionID: parentID,
      workspaceID: sync.session.get(parentID)?.workspaceID,
    })
  })

  // In subagent sessions, Esc should behave like Ctrl+B (background + return to parent).
  useKeyboard((evt) => {
    const parentID = session()?.parentID
    if (!parentID) return
    if (evt.name !== "escape") return

    evt.preventDefault()
    evt.stopPropagation()
    const job = sync.background.findBySession(route.sessionID)
    if (job) undismissBackground(parentID, job.rootDelegationID)
    navigate({
      type: "session",
      sessionID: parentID,
      workspaceID: sync.session.get(parentID)?.workspaceID,
    })
  })

  // Session pin toggle with <leader>p
  useKeyboard((evt) => {
    if (!keybind.match("session_pin_toggle", evt)) return
    evt.preventDefault()
    evt.stopPropagation()
    const sessionID = route.sessionID
    if (!sessionID) return
    const isPinned = local.session.isPinned(sessionID)
    local.session.togglePin(sessionID)
    toast.show({
      message: isPinned ? "Session unpinned" : "Session pinned",
      variant: "info",
      duration: 2000,
    })
  })

  // Quick-switch to pinned sessions with <leader>1-9
  useKeyboard((evt) => {
    if (!evt.name) return
    const num = parseInt(evt.name, 10)
    if (isNaN(num) || num < 1 || num > 9) return
    if (!keybind.match(`session_quick_switch_${num}`, evt)) return
    evt.preventDefault()
    evt.stopPropagation()
    const slots = local.session.slots()
    const targetSessionID = slots[num - 1]
    if (!targetSessionID) {
      toast.show({
        message: `No session pinned in slot ${num}`,
        variant: "warning",
        duration: 2000,
      })
      return
    }
    navigate({
      type: "session",
      sessionID: targetSessionID,
      workspaceID: sync.session.get(targetSessionID)?.workspaceID,
    })
  })

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messageSet = new Set(messages().map((m) => m.id))
    const scrollTop = scroll.y

    const isValidMessage = (c: (typeof children)[0]) => {
      if (!c.id || !messageSet.has(c.id)) return false
      const parts = sync.data.part[c.id]
      return parts?.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored) ?? false
    }

    // Children are already in DOM order (sorted by y), no need to re-sort
    if (direction === "next") {
      for (const c of children) {
        if (c.y > scrollTop + 10 && isValidMessage(c)) return c.id
      }
    } else {
      for (let i = children.length - 1; i >= 0; i--) {
        const c = children[i]
        if (c.y < scrollTop - 10 && isValidMessage(c)) return c.id
      }
    }
    return null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()

  function moveChild(direction: number) {
    const targets = backgroundWorkerChildren()
    if (targets.length === 0) return
    if (targets.length === 1 && targets[0]?.id === session()?.id) return
    let next = targets.findIndex((x) => x.id === session()?.id) + direction
    if (next >= targets.length) next = 0
    if (next < 0) next = targets.length - 1
    if (targets[next]) {
      navigate({
        type: "session",
        sessionID: targets[next].id,
        workspaceID: targets[next].workspaceID,
      })
    }
  }

  const command = useCommandDialog()
  command.register(() => [
    {
      title: commandLabels.backgroundSubtask,
      value: "subtask.background",
      keybind: "subtask_background",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        const parentID = session()?.parentID
        if (!parentID) return
        const job = sync.background.findBySession(route.sessionID)
        if (job) undismissBackground(parentID, job.rootDelegationID)
        navigate({
          type: "session",
          sessionID: parentID,
          workspaceID: sync.session.get(parentID)?.workspaceID,
        })
        dialog.clear()
      },
    },
    {
      title: commandLabels.backgroundAgents,
      value: "session.bg_agents",
      category: commandLabels.category,
      slash: {
        name: "bg-agents",
        aliases: ["monitors", "agents"],
      },
      onSelect: (dialog) => {
        const backgroundSessionID = session()?.parentID ?? route.sessionID
        void sync.background.sync(backgroundSessionID)
        dialog.replace(() => (
          <DialogBgAgents
            sessionID={backgroundSessionID}
            onOpenMonitor={(monitorID, title, command, status, logPath) => {
              dialog.setSize("xlarge")
              dialog.replace(
                () => (
                  <DialogMonitorLog
                    sessionID={backgroundSessionID}
                    monitorID={monitorID}
                    title={title}
                    command={command}
                    status={status}
                    logPath={logPath}
                  />
                ),
                () => dialog.setSize("medium"),
              )
            }}
          />
        ))
      },
    },
    {
      title: session()?.share?.url ? commandLabels.copyShareLink : commandLabels.share,
      value: "session.share",
      suggested: route.type === "session",
      keybind: "session_share",
      category: commandLabels.category,
      enabled: sync.data.config.share !== "disabled",
      slash: {
        name: "share",
      },
      onSelect: async (dialog) => {
        const copy = (url: string) =>
          Clipboard.copy(url)
            .then(() =>
              toast.show({
                message: lang.t("session.share.copied"),
                variant: "success",
              }),
            )
            .catch(() =>
              toast.show({
                message: "Failed to copy URL to clipboard",
                variant: "error",
              }),
            )

        const shareSession = async (client = sdk.client) => {
          const result = await client.session.share(
            {
              sessionID: route.sessionID,
            },
            { throwOnError: true },
          )
          const next = result.data?.share?.url
          if (!next) throw new Error("Share URL missing from session response")
          await copy(next)
        }

        const url = session()?.share?.url
        const shouldRefreshLocalShare =
          !!url &&
          /^https?:\/\/(?:127\.0\.0\.1|localhost|nikcli\.local)(?::\d+)?\//i.test(url) &&
          /^https?:\/\/nikcli\.local(?::\d+)?$/i.test(sdk.url)

        if (url && !shouldRefreshLocalShare) {
          await copy(url)
          dialog.clear()
          return
        }

        try {
          await shareSession()
        } catch (error) {
          const canStartLocalServer = /^https?:\/\/nikcli\.local(?::\d+)?$/i.test(sdk.url) && !!server.startServer
          if (!canStartLocalServer) {
            toast.show({
              message: shareErrorMessage(error),
              variant: "error",
              duration: 5000,
            })
            dialog.clear()
            return
          }

          try {
            const baseUrl = await server.startServer?.()
            if (!baseUrl) throw new Error("Failed to start local share server")
            const client = createNikcliClient({
              baseUrl,
              directory: sdk.directory,
              fetch: sdk.fetch,
            })
            await shareSession(client)
          } catch (retryError) {
            toast.show({
              message: shareErrorMessage(retryError),
              variant: "error",
              duration: 5000,
            })
          }
        }
        dialog.clear()
      },
    },
    {
      title: commandLabels.rename,
      value: "session.rename",
      keybind: "session_rename",
      category: commandLabels.category,
      slash: {
        name: "rename",
      },
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: commandLabels.jumpToMessage,
      value: "session.timeline",
      keybind: "session_timeline",
      category: commandLabels.category,
      slash: {
        name: "timeline",
      },
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: commandLabels.forkFromMessage,
      value: "session.fork",
      keybind: "session_fork",
      category: commandLabels.category,
      slash: {
        name: "fork",
      },
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: commandLabels.compact,
      value: "session.compact",
      keybind: "session_compact",
      category: commandLabels.category,
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      onSelect: (dialog) => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: commandLabels.unshare,
      value: "session.unshare",
      keybind: "session_unshare",
      category: commandLabels.category,
      enabled: !!session()?.share?.url,
      slash: {
        name: "unshare",
      },
      onSelect: async (dialog) => {
        const ok = await DialogConfirm.show(
          dialog,
          "Unshare session?",
          "This will revoke the public share URL. Anyone with the old link will no longer be able to view this session.",
          "confirm",
        )
        if (!ok) return
        await sdk.client.session
          .unshare({
            sessionID: route.sessionID,
          })
          .then(() =>
            toast.show({
              message: "Session unshared successfully",
              variant: "success",
            }),
          )
          .catch((error) =>
            toast.show({
              message: shareErrorMessage(error),
              variant: "error",
              duration: 5000,
            }),
          )
        dialog.clear()
      },
    },
    {
      title: commandLabels.undo,
      value: "session.undo",
      keybind: "messages_undo",
      category: commandLabels.category,
      slash: {
        name: "undo",
      },
      onSelect: async (dialog) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = session()?.revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: commandLabels.redo,
      value: "session.redo",
      keybind: "messages_redo",
      category: commandLabels.category,
      enabled: !!session()?.revert?.messageID,
      slash: {
        name: "redo",
      },
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: sidebarVisible() ? commandLabels.hideSidebar : commandLabels.showSidebar,
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: commandLabels.category,
      onSelect: (dialog) => {
        batch(() => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      title: commandLabels.toggleConceal,
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: commandLabels.category,
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? commandLabels.hideTimestamps : commandLabels.showTimestamps,
      value: "session.toggle.timestamps",
      category: commandLabels.category,
      slash: {
        name: "timestamps",
        aliases: ["toggle-timestamps"],
      },
      onSelect: (dialog) => {
        setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: showThinking() ? commandLabels.hideThinking : commandLabels.showThinking,
      value: "session.toggle.thinking",
      category: commandLabels.category,
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      onSelect: (dialog) => {
        setShowThinking((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: commandLabels.toggleDiffWrap,
      value: "session.toggle.diffwrap",
      category: commandLabels.category,
      slash: {
        name: "diffwrap",
      },
      onSelect: (dialog) => {
        setDiffWrapMode((prev) => (prev === "word" ? "none" : "word"))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? commandLabels.hideToolDetails : commandLabels.showToolDetails,
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: commandLabels.category,
      onSelect: (dialog) => {
        setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: commandLabels.toggleScrollbar,
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: commandLabels.category,
      onSelect: (dialog) => {
        setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: animationsEnabled() ? commandLabels.disableAnimations : commandLabels.enableAnimations,
      value: "session.toggle.animations",
      category: commandLabels.category,
      onSelect: (dialog) => {
        setAnimationsEnabled((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: commandLabels.pageUp,
      value: "session.page.up",
      keybind: "messages_page_up",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: commandLabels.pageDown,
      value: "session.page.down",
      keybind: "messages_page_down",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: commandLabels.lineUp,
      value: "session.line.up",
      keybind: "messages_line_up",
      category: commandLabels.category,
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: commandLabels.lineDown,
      value: "session.line.down",
      keybind: "messages_line_down",
      category: commandLabels.category,
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: commandLabels.halfPageUp,
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: commandLabels.halfPageDown,
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: commandLabels.firstMessage,
      value: "session.first",
      keybind: "messages_first",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: commandLabels.lastMessage,
      value: "session.last",
      keybind: "messages_last",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: commandLabels.lastUserMessage,
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: commandLabels.category,
      hidden: true,
      onSelect: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: commandLabels.nextMessage,
      value: "session.message.next",
      keybind: "messages_next",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => scrollToMessage("next", dialog),
    },
    {
      title: commandLabels.prevMessage,
      value: "session.message.previous",
      keybind: "messages_previous",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => scrollToMessage("prev", dialog),
    },
    {
      title: commandLabels.copyLastAssistant,
      value: "messages.copy",
      keybind: "messages_copy",
      category: commandLabels.category,
      onSelect: (dialog) => {
        const revertID = session()?.revert?.messageID
        const lastAssistantMessage = messages().findLast(
          (msg) => msg.role === "assistant" && (!revertID || msg.id < revertID),
        )
        if (!lastAssistantMessage) {
          toast.show({
            message: "No assistant messages found",
            variant: "error",
          })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({
            message: "No text parts found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        Clipboard.copy(text)
          .then(() =>
            toast.show({
              message: "Message copied to clipboard!",
              variant: "success",
            }),
          )
          .catch(() =>
            toast.show({
              message: "Failed to copy to clipboard",
              variant: "error",
            }),
          )
        dialog.clear()
      },
    },
    {
      title: commandLabels.copyTranscript,
      value: "session.copy",
      category: commandLabels.category,
      slash: {
        name: "copy",
      },
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({
              info: msg,
              parts: sync.data.part[msg.id] ?? [],
            })),
            {
              thinking: showThinking(),
              toolDetails: showDetails(),
              assistantMetadata: showAssistantMetadata(),
            },
          )
          await Clipboard.copy(transcript)
          toast.show({
            message: "Session transcript copied to clipboard!",
            variant: "success",
          })
        } catch {
          toast.show({
            message: "Failed to copy session transcript",
            variant: "error",
          })
        }
        dialog.clear()
      },
    },
    {
      title: commandLabels.exportTranscript,
      value: "session.export",
      category: commandLabels.category,
      slash: {
        name: "export",
      },
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()

          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            showThinking(),
            showDetails(),
            showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({
              info: msg,
              parts: sync.data.part[msg.id] ?? [],
            })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
            },
          )

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await Editor.open({ value: transcript, renderer })
          } else {
            const exportDir = process.cwd()
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await Bun.write(filepath, transcript)

            // Open with EDITOR if available
            const result = await Editor.open({ value: transcript, renderer })
            if (result !== undefined) {
              await Bun.write(filepath, result)
            }

            toast.show({
              message: `Session exported to ${filename}`,
              variant: "success",
            })
          }
        } catch {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: commandLabels.nextChild,
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        moveChild(1)
        dialog.clear()
      },
    },
    {
      title: commandLabels.prevChild,
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        moveChild(-1)
        dialog.clear()
      },
    },
    {
      title: commandLabels.parent,
      value: "session.parent",
      keybind: "session_parent",
      category: commandLabels.category,
      hidden: true,
      onSelect: (dialog) => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
            workspaceID: sync.session.get(parentID)?.workspaceID,
          })
        }
        dialog.clear()
      },
    },
    {
      title: commandLabels.closeSubagent,
      value: "session.child.close",
      keybind: "session_child_close",
      category: commandLabels.category,
      hidden: true,
      onSelect: async (dialog) => {
        const parentID = session()?.parentID
        const currentID = route.sessionID
        const status = sync.data.session_status[currentID]?.type

        if (parentID && currentID) {
          // If busy, kill the task (which also removes it from background)
          if (status !== "idle") {
            await sdk.client.session.abort({ sessionID: currentID }).catch(() => {})
          } else {
            // If idle, just remove from background tasks
            const job = sync.background.findBySession(currentID)
            if (job) dismissBackground(parentID, job.rootDelegationID)
          }

          navigate({
            type: "session",
            sessionID: parentID,
            workspaceID: sync.session.get(parentID)?.workspaceID,
          })
        }
        dialog.clear()
      },
    },
  ])

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => {
    const diffText = revertInfo()?.diff ?? ""
    if (!diffText) return []

    try {
      const patches = parsePatch(diffText)
      return patches.map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        const cleanFilename = filename.replace(/^[ab]\//, "")
        return {
          filename: cleanFilename,
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
    } catch {
      return []
    }
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  const dialog = useDialog()
  const renderer = useRenderer()

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        sessionID: route.sessionID,
        conceal,
        showThinking,
        showTimestamps,
        showDetails,
        diffWrapMode,
        messageCreatedAt,
        sync,
      }}
    >
      <box flexDirection="row">
        <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show when={session()}>
            <scrollbox
              ref={(r) => (scroll = r)}
              viewportOptions={{
                paddingRight: showScrollbar() ? 1 : 0,
              }}
              verticalScrollbarOptions={{
                paddingLeft: 1,
                visible: showScrollbar(),
                trackOptions: {
                  backgroundColor: theme.backgroundElement,
                  foregroundColor: theme.border,
                },
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
            >
              <Show when={windowed().top > 0}>
                <box height={windowed().top} flexShrink={0} />
              </Show>
              {/* RevertBanner is rendered outside <For> so virtualization cannot
                  unmount it on slice change — keeps click handlers alive when
                  the user scrolls while the banner is visible. */}
              <Show when={revert()}>
                <RevertBanner count={revert()!.reverted.length} diffFiles={revert()!.diffFiles} />
              </Show>
              <For each={windowed().items}>
                {(message, index) => (
                  <Switch>
                    <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                      <></>
                    </Match>
                    <Match when={message.role === "user"}>
                      <UserMessage
                        index={windowed().baseIndex + index()}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          dialog.replace(() => (
                            <DialogMessage
                              messageID={message.id}
                              sessionID={route.sessionID}
                              setPrompt={(promptInfo) => prompt.set(promptInfo)}
                            />
                          ))
                        }}
                        message={message as UserMessage}
                        parts={sync.data.part[message.id] ?? []}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={lastAssistant()?.id === message.id}
                        message={message as AssistantMessage}
                        parts={sync.data.part[message.id] ?? []}
                        turn={turnUsage()?.get(message.id)}
                      />
                    </Match>
                  </Switch>
                )}
              </For>
              <Show when={windowed().bottom > 0}>
                <box height={windowed().bottom} flexShrink={0} />
              </Show>
            </scrollbox>
            <box flexShrink={0}>
              <Show when={permissions().length > 0}>
                <PermissionPrompt request={permissions()[0]} />
              </Show>
              <Show when={permissions().length === 0 && questions().length > 0}>
                <QuestionPrompt request={questions()[0]} />
              </Show>
              <Show when={session()?.parentID && permissions().length === 0 && questions().length === 0}>
                <SubagentFooter />
              </Show>
              <Prompt
                visible={!session()?.parentID && permissions().length === 0 && questions().length === 0}
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                  // Apply initial prompt when prompt component mounts (e.g., from fork)
                  if (route.initialPrompt) {
                    r.set(route.initialPrompt)
                  }
                }}
                disabled={permissions().length > 0 || questions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar sessionID={route.sessionID} />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-end"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <Sidebar sessionID={route.sessionID} />
              </box>
            </Match>
          </Switch>
        </Show>
      </box>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => local.agent.color(props.message.agent))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())
  const terminalDimensions = useTerminalDimensions()
  const imagePreviewColumns = createMemo(() => Math.max(24, Math.min(180, ctx.width - 8)))
  const imagePreviewRows = createMemo(() => Math.max(4, Math.floor(terminalDimensions().height / 3)))
  const imagePreviewUrls = createMemo(() =>
    files()
      .filter((file) => file.mime.startsWith("image/") && file.mime !== "image/svg+xml")
      .flatMap((file) => (file.url ? [file.url] : file.source?.type === "file" ? [file.source.path] : [])),
  )

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text() || files().length > 0}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <Show when={text()}>{(part) => <text fg={theme.text}>{part().text}</text>}</Show>
            <TuiImageList
              text={text()?.text ?? ""}
              urls={imagePreviewUrls()}
              maxColumns={imagePreviewColumns()}
              maxRows={imagePreviewRows()}
            />
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span
                          style={{
                            bg: theme.backgroundElement,
                            fg: theme.textMuted,
                          }}
                        >
                          {" "}
                          {file.filename}{" "}
                        </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <Show
              when={queued()}
              fallback={
                <Show when={ctx.showTimestamps()}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.textMuted }}>
                      {Locale.todayTimeOrDateTime(props.message.time.created)}
                    </span>
                  </text>
                </Show>
              }
            >
              <text fg={theme.textMuted}>
                <span style={{ bg: color(), fg: queuedFg(), bold: true }}> QUEUED </span>
              </text>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean; turn?: TurnUsage.Turn }) {
  const ctx = use()
  const local = useLocal()
  const sync = useSync()
  const { theme } = useTheme()

  /**
   * Parts, with finished runs of read-only tool calls folded into one row.
   *
   * A live run stays fully expanded on purpose: collapsing it would hide work in
   * progress, and rebuilding the group row on every streamed delta would remount
   * its children. Only a run that is over — something followed it, or the message
   * finished — becomes a summary. With the flag off this is `props.parts`
   * unchanged, so the default render path keeps its stable part identities.
   */
  const rows = createMemo<(Part | ExplorationGroup<Part>)[]>(() => {
    if (!features(sync.data.config).tui.explorationGrouping) return props.parts
    const blocked = new Set(
      (sync.data.permission[props.message.sessionID] ?? []).flatMap((request) =>
        request.tool?.callID ? [request.tool.callID] : [],
      ),
    )
    return groupParts(props.parts, {
      closed: Boolean(props.message.time.completed),
      isPending: (part) => "callID" in part && typeof part.callID === "string" && blocked.has(part.callID),
    }).flatMap<Part | ExplorationGroup<Part>>((row) =>
      row.type === "part" ? [row.part] : row.completed ? [row] : row.parts,
    )
  })

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const stats = createMemo(() => {
    const created = ctx.messageCreatedAt()[props.message.parentID]
    if (!created) return null

    const completedAt = props.message.time.completed ?? Date.now()
    const duration = completedAt - created

    let text = ""
    let streamStart: number | undefined
    let streamEnd: number | undefined

    for (const part of props.parts) {
      if (part.type !== "text") continue
      text += part.text
      if (!part.time?.start) continue
      streamStart = streamStart === undefined ? part.time.start : Math.min(streamStart, part.time.start)
      const end = part.time.end ?? completedAt
      streamEnd = streamEnd === undefined ? end : Math.max(streamEnd, end)
    }

    if (streamStart === undefined || streamEnd === undefined) {
      return {
        duration,
        tps: 0,
      }
    }

    const streamDuration = Math.max(0, streamEnd - streamStart)
    const outputTokens = props.message.tokens.output > 0 ? props.message.tokens.output : Token.estimate(text)

    return {
      duration,
      tps: streamDuration > 0 && outputTokens > 0 ? outputTokens / (streamDuration / 1000) : 0,
    }
  })

  return (
    <>
      <For each={rows()}>
        {(row) => {
          if (row.type === "group") return <ExplorationSummary group={row} message={props.message} />
          const component = PART_MAPPING[row.type as keyof typeof PART_MAPPING]
          return (
            <Show when={component}>
              <Dynamic
                last={row === props.parts[props.parts.length - 1]}
                component={component}
                part={row as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span
                style={{
                  fg:
                    props.message.error?.name === "MessageAbortedError"
                      ? theme.textMuted
                      : local.agent.color(props.message.agent),
                }}
              >
                ▣{" "}
              </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={stats()}>
                {(value) => (
                  <span style={{ fg: theme.textMuted }}>
                    {" "}
                    · {Locale.duration(value().duration)}
                    <Show when={value().tps > 0}> · {value().tps.toFixed(0)} tok/s</Show>
                  </span>
                )}
              </Show>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · interrupted</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
      <Show when={props.turn}>{(turn) => <TurnTokens turn={turn()} />}</Show>
    </>
  )
}

/**
 * Per-turn token table. Off by default (`tui.turn_tokens`); the parent only
 * builds the data when it is on, so this renders nothing on the default path.
 */
function TurnTokens(props: { turn: TurnUsage.Turn }) {
  const { theme } = useTheme()
  const num = (value: number) => value.toLocaleString()
  const widths = createMemo(() => {
    const steps = props.turn.steps
    return {
      step: Math.max("Step".length, ...steps.map((s) => s.finish.length)),
      newTokens: Math.max("New".length, ...steps.map((s) => num(s.newTokens).length), num(props.turn.newTokens).length),
      cached: Math.max("Cached".length, ...steps.map((s) => num(s.cached).length), num(props.turn.cached).length),
      total: Math.max("Total".length, ...steps.map((s) => num(s.total).length), num(props.turn.total).length),
    }
  })
  const row = (step: string, a: string, b: string, c: string) =>
    `${step.padEnd(widths().step + 2)}${a.padStart(widths().newTokens)}  ${b.padStart(widths().cached)}  ${c.padStart(widths().total)}`

  return (
    <box paddingLeft={3} flexDirection="column">
      <text fg={theme.textMuted}>{row("Step", "New", "Cached", "Total")}</text>
      <For each={props.turn.steps}>
        {(step) => (
          <text fg={theme.textMuted}>
            {row(step.finish, num(step.newTokens), num(step.cached), num(step.total))}
            <Show when={step.cacheBust !== undefined}>
              <span style={{ fg: theme.warning }}> ⚠ cache bust −{num(step.cacheBust!)}</span>
            </Show>
          </text>
        )}
      </For>
      <Show when={props.turn.steps.length > 1}>
        <text fg={theme.textMuted}>
          {row("turn", num(props.turn.newTokens), num(props.turn.cached), num(props.turn.total))}
        </text>
      </Show>
    </box>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

/**
 * One line standing in for a finished run of read-only tool calls.
 *
 * Anything the user still has to answer is rendered in full underneath: a
 * permission prompt must never be what got collapsed away.
 */
function ExplorationSummary(props: { group: ExplorationGroup<Part>; message: AssistantMessage }) {
  const { theme } = useTheme()
  return (
    <>
      <box paddingLeft={3}>
        <text paddingLeft={3} fg={theme.textMuted}>
          ⋮ {groupLabel(props.group)}
        </text>
      </box>
      <For each={props.group.pending}>
        {(part) => <ToolPart last={false} part={part as ToolPart} message={props.message} />}
      </For>
    </>
  )
}

// Box-drawing / arrow chars that signal an ASCII diagram. When the assistant
// emits raw diagrams in prose, the markdown renderer would otherwise paint them
// in plain theme.text. Wrapping diagram-looking line runs in a fenced code
// block delegates to opentui's CodeRenderable, which restores the themed
// `markdownCodeBlock` coloring that the old `<code filetype="markdown">` path
// produced — without losing real markdown structure (headings, lists, tables)
// elsewhere in the message.
const DIAGRAM_CHARS = new Set(
  "─━│┃┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋" +
    "═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳" +
    "▲▼◀▶△▽◁▷◆◇■□●○◉◍◎★☆" +
    "←→↑↓↔↕⇐⇒⇑⇓⇔⇕",
)

function looksLikeDiagramLine(line: string): boolean {
  let count = 0
  for (const ch of line) {
    if (DIAGRAM_CHARS.has(ch)) {
      count++
      if (count >= 2) return true
    }
  }
  return false
}

function wrapDiagramsInFences(md: string): string {
  if (md.length === 0) return md
  // Fast path: no diagram chars at all
  let hasAny = false
  for (let i = 0; i < md.length; i++) {
    if (DIAGRAM_CHARS.has(md[i])) {
      hasAny = true
      break
    }
  }
  if (!hasAny) return md

  const lines = md.split("\n")
  const out: string[] = []
  let inFence = false
  let blockStart = -1

  const flush = (endIdx: number) => {
    if (blockStart < 0) return
    out.push("```")
    for (let j = blockStart; j <= endIdx; j++) out.push(lines[j])
    out.push("```")
    blockStart = -1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      flush(i - 1)
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    if (looksLikeDiagramLine(line)) {
      if (blockStart < 0) blockStart = i
      continue
    }
    flush(i - 1)
    out.push(line)
  }
  flush(lines.length - 1)
  return out.join("\n")
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    // Filter out redacted reasoning chunks from OpenRouter
    // OpenRouter sends encrypted reasoning data that appears as [REDACTED]
    return (
      props.part.text
        .replace("[REDACTED]", "")
        // OpenAI Responses reasoning summaries separate sections with empty
        // HTML comments (`<!-- -->`); they are markers, not content.
        .replace(/<!--\s*-->/g, "")
        .trim()
    )
  })
  const summary = createMemo(() => reasoningSummary(content()))
  const body = createMemo(() => (summary().body ? wrapDiagramsInFences(summary().body) : ""))
  const tight = createMemo(() => ctx.width < 84)
  const done = createMemo(() => {
    const end = props.part.time.end
    return end !== undefined
  })
  const duration = createMemo(() => {
    const end = props.part.time.end
    if (end === undefined) return
    return Locale.duration(end - props.part.time.start)
  })
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
      >
        <ReasoningHeader done={done()} title={summary().title} duration={duration()} />
        <Show when={summary().body}>
          <box marginTop={1}>
            <markdown
              streaming={!props.last ? false : true}
              syntaxStyle={subtleSyntax()}
              content={body()}
              conceal={ctx.conceal()}
              concealCode={false}
              fg={theme.textMuted}
              tableOptions={{
                widthMode: "full",
                wrapMode: "word",
                cellPadding: tight() ? 0 : 1,
                borders: true,
                outerBorder: !tight(),
                borderColor: theme.borderSubtle,
              }}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: { done: boolean; title: string | null; duration?: string }) {
  const { theme } = useTheme()
  return (
    <Switch>
      <Match when={!props.done}>
        <box flexDirection="row">
          <Spinner color={theme.warning}>{props.title ? "Thinking: " + props.title : "Thinking"}</Spinner>
        </box>
      </Match>
      <Match when={props.done}>
        <text fg={theme.warning} wrapMode="none">
          <span>Thought</span>
          <Show when={props.title || props.duration}>
            <span>: </span>
          </Show>
          <Show when={props.title}>
            <span>{props.title}</span>
          </Show>
          <Show when={props.duration}>
            <span>
              {props.title ? " · " : ""}
              {props.duration}
            </span>
          </Show>
        </text>
      </Match>
    </Switch>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const terminalDimensions = useTerminalDimensions()
  const imagePreviewColumns = createMemo(() => Math.max(24, Math.min(180, ctx.width - 8)))
  const imagePreviewRows = createMemo(() => Math.max(4, Math.floor(terminalDimensions().height / 3)))
  const tight = createMemo(() => ctx.width < 84)
  const rendered = createMemo(() => wrapDiagramsInFences(props.part.text.trim()))

  // O2: streaming tokens-per-sec indicator. Counts chars (4-chars-per-token
  // heuristic) every second, shows the rolling rate as a small badge.
  const streamingSpeed = createStreamingSpeed(rendered, () => !props.last)

  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <markdown
          streaming={!props.last ? false : true}
          syntaxStyle={syntax()}
          content={rendered()}
          conceal={ctx.conceal()}
          concealCode={false}
          fg={theme.text}
          tableOptions={{
            widthMode: "full",
            wrapMode: "word",
            cellPadding: tight() ? 0 : 1,
            borders: true,
            outerBorder: !tight(),
            borderColor: theme.borderSubtle,
          }}
        />
        <TuiImageList text={props.part.text} maxColumns={imagePreviewColumns()} maxRows={imagePreviewRows()} />
      </box>
    </Show>
  )
}

/**
 * Track the rendered text length over time and report a rolling tokens-per-
 * second rate. Returns `{ rate, total }` where `rate` is 0 when not
 * streaming. Uses a 2-sample rolling window updated every second.
 */
function createStreamingSpeed(text: () => string, isStreaming: () => boolean) {
  const [rate, setRate] = createSignal(0)
  const [total, setTotal] = createSignal(0)

  let lastText = ""
  let lastTime = 0
  let timer: ReturnType<typeof setInterval> | undefined

  const tick = () => {
    const now = Date.now()
    const len = text().length
    const dt = now - lastTime
    if (dt > 0 && len !== lastText.length) {
      const dChars = len - lastText.length
      // 4 chars per token is the standard English-text heuristic.
      const dTokens = Math.max(0, dChars) / 4
      const perSec = (dTokens / dt) * 1000
      setRate(Math.round(perSec))
    }
    lastText = text()
    lastTime = now
    setTotal(Math.round(len / 4))
  }

  onMount(() => {
    timer = setInterval(tick, 1000)
  })
  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  // Reset when streaming ends.
  createEffect(() => {
    if (!isStreaming()) {
      setTimeout(() => setRate(0), 2000)
    }
  })

  return {
    get rate() {
      return rate()
    },
    get total() {
      return total()
    },
  }
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const sync = useSync()
  const terminalDimensions = useTerminalDimensions()
  const imagePreviewColumns = createMemo(() => Math.max(24, Math.min(180, ctx.width - 8)))
  const imagePreviewRows = createMemo(() => Math.max(4, Math.floor(terminalDimensions().height / 3)))
  const imagePreviewUrls = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    return (props.part.state.attachments ?? [])
      .filter((file) => file.mime.startsWith("image/") && file.mime !== "image/svg+xml")
      .flatMap((file) => (file.url ? [file.url] : file.source?.type === "file" ? [file.source.path] : []))
  })

  // Hide tool if showDetails is false and tool completed successfully
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return imagePreviewUrls().length === 0
  })

  const toolprops = {
    get metadata() {
      if (props.part.state.status === "pending") return {}
      return {
        ...(props.part.state.metadata ?? {}),
        ...(props.part.state.status === "running" ? (props.part.state.structured ?? {}) : {}),
      }
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      const permissions = sync.data.permission[props.message.sessionID] ?? []
      const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
      return permissions[permissionIndex]
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <>
      <Show when={!shouldHide()}>
        <Switch>
          <Match when={props.part.tool === "bash"}>
            <Bash {...toolprops} />
          </Match>
          <Match when={props.part.tool === "exec_code" || props.part.tool === "code_mode"}>
            <ExecCode {...toolprops} />
          </Match>
          <Match when={props.part.tool === "glob"}>
            <Glob {...toolprops} />
          </Match>
          <Match when={props.part.tool === "read"}>
            <Read {...toolprops} />
          </Match>
          <Match when={props.part.tool === "grep"}>
            <Grep {...toolprops} />
          </Match>
          <Match when={props.part.tool === "list"}>
            <List {...toolprops} />
          </Match>
          <Match when={props.part.tool === "webfetch"}>
            <WebFetch {...toolprops} />
          </Match>
          <Match when={props.part.tool === "codesearch"}>
            <CodeSearch {...toolprops} />
          </Match>
          <Match when={props.part.tool === "websearch"}>
            <WebSearch {...toolprops} />
          </Match>
          <Match when={props.part.tool === "write"}>
            <Write {...toolprops} />
          </Match>
          <Match when={props.part.tool === "edit"}>
            <Edit {...toolprops} />
          </Match>
          <Match when={props.part.tool === "task"}>
            <Task {...toolprops} />
          </Match>
          <Match when={props.part.tool === "monitor"}>
            <Monitor {...toolprops} />
          </Match>
          <Match when={props.part.tool === "apply_patch"}>
            <ApplyPatch {...toolprops} />
          </Match>
          <Match when={props.part.tool === "todowrite"}>
            <TodoWrite {...toolprops} />
          </Match>
          <Match when={props.part.tool === "question"}>
            <Question {...toolprops} />
          </Match>
          <Match when={props.part.tool === "opentui"}>
            <OpenTUIViz {...toolprops} />
          </Match>
          <Match when={props.part.tool === "browser"}>
            <BrowserUse {...toolprops} />
          </Match>
          <Match when={props.part.tool === "computer"}>
            <ComputerUse {...toolprops} />
          </Match>
          <Match when={props.part.tool === "artifact"}>
            <ArtifactView {...toolprops} />
          </Match>
          <Match when={true}>
            <GenericTool {...toolprops} />
          </Match>
        </Switch>
      </Show>
      <Show when={imagePreviewUrls().length > 0}>
        <box paddingLeft={3} flexShrink={0}>
          <TuiImageList urls={imagePreviewUrls()} maxColumns={imagePreviewColumns()} maxRows={imagePreviewRows()} />
        </box>
      </Show>
    </>
  )
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  part: ToolPart
}

function BrowserUse(props: ToolProps<typeof BrowserTool>) {
  const { theme } = useTheme()
  const action = createMemo(() => props.metadata.action ?? props.input.action ?? "browser")
  const label = createMemo(() => (props.metadata.name ? `${action()} · ${props.metadata.name}` : action()))

  return (
    <Switch>
      <Match when={props.output !== undefined}>
        <BlockTool
          title={`# Browser · ${label()}`}
          titleColor={theme.primary}
          accentColor={theme.primary}
          part={props.part}
        >
          <box gap={1}>
            <text fg={theme.textMuted}>{props.output}</text>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon="◎"
          iconColor={theme.primary}
          pending="Running browser action..."
          complete={label()}
          part={props.part}
        >
          Browser · {label()}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ComputerUse(props: ToolProps<typeof ComputerTool>) {
  const { theme } = useTheme()
  const action = createMemo(() => props.input.action ?? "computer")
  const mode = createMemo(() => (props.metadata as Record<string, any>).mode as string | undefined)
  const liveUrl = createMemo(() => (props.metadata as Record<string, any>).liveUrl as string | undefined)
  const label = createMemo(() => (mode() === "host" ? "Computer" : "Computer (bg)"))
  return (
    <Switch>
      <Match when={props.output !== undefined}>
        <BlockTool
          title={`# ${label()} · ${action()}`}
          titleColor={theme.warning}
          accentColor={theme.warning}
          part={props.part}
        >
          <box gap={1}>
            <text fg={theme.textMuted}>{props.output}</text>
            <Show when={liveUrl()}>{(url) => <text fg={theme.textMuted}>Live preview: {url()}</text>}</Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon="▣"
          iconColor={theme.warning}
          pending="Waiting for computer use..."
          complete={action()}
          part={props.part}
        >
          {label()} · {action()}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ArtifactView(props: ToolProps<typeof ArtifactTool>) {
  const { theme } = useTheme()
  const title = createMemo(() => props.metadata.title ?? props.input.title ?? "Artifact")
  const url = createMemo(() => props.metadata.url)
  const detail = createMemo(() => {
    const kind = props.metadata.kind ? String(props.metadata.kind).toUpperCase() : "ARTIFACT"
    const version = props.metadata.version ? ` · v${props.metadata.version}` : ""
    return `${kind}${version}`
  })

  return (
    <Switch>
      <Match when={props.output !== undefined}>
        <BlockTool
          title={`# Published · ${title()}`}
          titleColor={theme.primary}
          accentColor={theme.primary}
          part={props.part}
        >
          <box gap={1}>
            <text fg={theme.textMuted}>{detail()}</text>
            <Show when={url()}>{(value) => <Link href={value()} fg={theme.primary} />}</Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon="◇"
          iconColor={theme.primary}
          pending={`Publishing ${title()}...`}
          complete={title()}
          part={props.part}
        >
          Artifact · {title()}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function GenericTool(props: ToolProps<any>) {
  return (
    <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
      {props.tool} {input(props.input)}
    </InlineTool>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  complete: any
  pending: string
  children: JSX.Element
  part: ToolPart
}) {
  const [margin, setMargin] = createSignal(0)
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const fg = createMemo(() => {
    if (permission()) return theme.warning
    if (props.complete) return theme.textMuted
    return theme.text
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      <text paddingLeft={3} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
        <Show fallback={<>~ {props.pending}</>} when={props.complete}>
          <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
        </Show>
      </text>
      <Show when={error() && !denied()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function BlockTool(props: {
  title: string
  titleColor?: RGBA
  accentColor?: RGBA
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  /** Skip the accent background tint — keep accent only on border/title. */
  transparent?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))

  const backgroundColor = createMemo(() => {
    // Fully transparent: paint nothing, let the session background show through.
    if (props.transparent) return hover() ? theme.backgroundMenu : undefined
    const base = hover() ? theme.backgroundMenu : theme.backgroundPanel
    const accent = props.accentColor
    if (!accent) return base

    // Adapt tint intensity for light vs dark panels.
    const luminance = 0.299 * base.r + 0.587 * base.g + 0.114 * base.b
    const isLight = luminance > 0.55
    const alpha = hover() ? (isLight ? 0.1 : 0.16) : isLight ? 0.06 : 0.12

    // Preserve the panel alpha channel (important for transparent themes).
    const tinted = tint(base, accent, alpha)
    const a = base.a <= 1 ? Math.round(base.a * 255) : Math.round(base.a)
    return RGBA.fromInts(Math.round(tinted.r * 255), Math.round(tinted.g * 255), Math.round(tinted.b * 255), a)
  })

  const borderColor = createMemo(() => props.accentColor ?? theme.background)
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={backgroundColor()}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={borderColor()}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <text paddingLeft={3} fg={props.titleColor ?? theme.textMuted}>
        {props.title}
      </text>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Bash(props: ToolProps<typeof BashTool>) {
  const { theme } = useTheme()
  const sync = useSync()
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })

  // Prefer streamed input; fall back to metadata.command published at execute start
  // so the running command is visible before the model finishes the tool-call args.
  const command = createMemo(() => {
    if (typeof props.input.command === "string" && props.input.command.length > 0) return props.input.command
    const metaCmd = (props.metadata as { command?: string }).command
    return typeof metaCmd === "string" ? metaCmd : undefined
  })

  const workdirDisplay = createMemo(() => {
    const workdir = props.input.workdir
    if (!workdir || workdir === ".") return undefined

    const base = sync.data.path.directory
    if (!base) return undefined

    const absolute = path.resolve(base, workdir)
    if (absolute === base) return undefined

    const home = Global.Path.home
    if (!home) return absolute

    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  })

  const title = createMemo(() => {
    const metaDesc = (props.metadata as { description?: string }).description
    const desc =
      (typeof props.input.description === "string" && props.input.description) ||
      (typeof metaDesc === "string" && metaDesc) ||
      "Shell"
    const wd = workdirDisplay()
    if (!wd) return `# ${desc}`
    if (desc.includes(wd)) return `# ${desc}`
    return `# ${desc} in ${wd}`
  })

  // Show the block as soon as we know the command (input or early metadata),
  // not only after the first stdout chunk — avoids stuck "Writing command...".
  const showRunning = createMemo(() => props.metadata.output !== undefined || Boolean(command()))

  return (
    <Switch>
      <Match when={showRunning()}>
        <BlockTool
          title={title()}
          part={props.part}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {command() ?? "…"}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={command()} part={props.part}>
          {command()}
        </InlineTool>
      </Match>
    </Switch>
  )
}
function ExecCode(props: ToolProps<any>) {
  const { theme, syntax } = useTheme()

  type CodeModeCall = {
    tool: string
    status: "running" | "completed" | "error" | "interrupted"
    input?: Record<string, unknown>
  }

  const input = createMemo(
    () =>
      (props.input ?? {}) as {
        code?: string
        timeout?: number
        maxToolCalls?: number
        maxOutputBytes?: number
      },
  )
  const meta = createMemo(
    () =>
      (props.metadata ?? {}) as {
        success?: boolean
        durationMs?: number
        toolCalls?: CodeModeCall[]
      },
  )
  const toolCalls = createMemo(() => meta().toolCalls?.filter(isCodeModeCall) ?? [])

  const code = createMemo<string>(() => input().code ?? "")
  const codeLines = createMemo(() => code().split("\n"))
  const codeOverflow = createMemo(() => codeLines().length > 20)

  const output = createMemo(() => stripAnsi((props.output ?? "").trim()))
  const outputLines = createMemo(() => output().split("\n"))
  const outputOverflow = createMemo(() => outputLines().length > 10)

  const [expanded, setExpanded] = createSignal(false)
  const callsOverflow = createMemo(() => toolCalls().length > 12)
  const overflow = createMemo(() => codeOverflow() || outputOverflow() || callsOverflow())

  const limitedCode = createMemo(() => {
    if (expanded() || !codeOverflow()) return code()
    return [...codeLines().slice(0, 20), "…"].join("\n")
  })

  const limitedOutput = createMemo(() => {
    if (expanded() || !outputOverflow()) return output()
    return [...outputLines().slice(0, 10), "…"].join("\n")
  })

  const visibleToolCalls = createMemo(() => {
    if (expanded() || !callsOverflow()) return toolCalls()
    return toolCalls().slice(-12)
  })

  const success = createMemo(() => meta().success !== false && props.part.state.status !== "error")
  const duration = createMemo(() => meta().durationMs)
  const accent = createMemo(() => (success() ? theme.success : theme.error))

  const title = createMemo(() => {
    const ms = duration() != null ? ` · ${duration()}ms` : ""
    const icon = success() ? "✓" : "✗"
    const label = props.tool === "code_mode" ? "Code Mode" : "Execute Code"
    return `# ${label}${ms} ${icon}`
  })

  const firstLine = createMemo(() => {
    const first = code().split("\n")[0] ?? ""
    return first.length > 60 ? first.slice(0, 60) + "…" : first
  })

  return (
    <Switch>
      <Match when={props.output !== undefined}>
        <BlockTool
          title={title()}
          titleColor={accent()}
          accentColor={accent()}
          part={props.part}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
              <code
                conceal={false}
                fg={theme.text}
                filetype="typescript"
                syntaxStyle={syntax()}
                content={limitedCode()}
              />
            </line_number>
            <CodeModeToolCalls calls={visibleToolCalls()} />
            <Show when={output().length > 0}>
              <text fg={theme.textMuted}>── output ──</text>
              <text fg={success() ? theme.text : theme.error}>{limitedOutput()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <>
          <InlineTool icon="⚡" iconColor={theme.warning} pending="Running code..." complete={code()} part={props.part}>
            {props.tool} {firstLine()}
          </InlineTool>
          <CodeModeToolCalls calls={visibleToolCalls()} />
        </>
      </Match>
    </Switch>
  )

  function isCodeModeCall(value: unknown): value is CodeModeCall {
    if (!value || typeof value !== "object") return false
    const call = value as Partial<CodeModeCall>
    return (
      typeof call.tool === "string" &&
      (call.status === "running" ||
        call.status === "completed" ||
        call.status === "error" ||
        call.status === "interrupted")
    )
  }

  function CodeModeToolCalls(callProps: { calls: CodeModeCall[] }) {
    return (
      <Show when={callProps.calls.length > 0}>
        <box paddingLeft={3} gap={0}>
          <text fg={theme.textMuted}>── nested tools ──</text>
          <For each={callProps.calls}>
            {(call) => {
              // An interrupted call was cancelled, not failed — a red ✗ next to it
              // reads as the tool having broken.
              const marker =
                call.status === "running"
                  ? "◌"
                  : call.status === "completed"
                    ? "✓"
                    : call.status === "interrupted"
                      ? "⊘"
                      : "✗"
              const color =
                call.status === "running"
                  ? theme.warning
                  : call.status === "completed"
                    ? theme.success
                    : call.status === "interrupted"
                      ? theme.textMuted
                      : theme.error
              const details = summarizeCodeModeInput(call.input)
              return (
                <text fg={color}>
                  {marker} {call.tool}
                  <Show when={details.length > 0}>
                    <span style={{ fg: theme.textMuted }}> {details}</span>
                  </Show>
                </text>
              )
            }}
          </For>
        </box>
      </Show>
    )
  }
}

function summarizeCodeModeInput(value?: Record<string, unknown>) {
  if (!value) return ""
  const summary = input(value)
  return summary.length > 120 ? summary.slice(0, 119) + "…" : summary
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  const diagnostics = createMemo(() => {
    const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
    return props.metadata.diagnostics?.[filePath] ?? []
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + normalizePath(props.input.filePath!)} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Show when={diagnostics().length}>
            <For each={diagnostics()}>
              {(diagnostic) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
                </text>
              )}
            </For>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalizePath(props.input.filePath!)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  return (
    <InlineTool icon="→" pending="Reading file..." complete={props.input.filePath} part={props.part}>
      Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
    </InlineTool>
  )
}

function Grep(props: ToolProps<typeof GrepTool>) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.matches}>({String(props.metadata.matches)} matches)</Show>
    </InlineTool>
  )
}

function List(props: ToolProps<typeof ListTool>) {
  const dir = createMemo(() => {
    if (props.input.path) {
      return normalizePath(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  const input = props.input as any
  const { theme } = useTheme()
  const dialog = useDialog()
  const url = createMemo(() => String(input.url ?? "").trim())
  const format = createMemo(() => String(input.format ?? "markdown"))
  const host = createMemo(() => formatURLHost(url()))

  const openPreview = () => {
    if (!url()) return
    dialog.replace(() => <DialogWebPreview url={url()} />)
  }

  return (
    <Switch>
      <Match when={props.output !== undefined && url()}>
        <BlockTool
          title={`# Web fetch: ${host()}`}
          accentColor={theme.primary}
          titleColor={theme.primary}
          onClick={openPreview}
          part={props.part}
        >
          <box gap={0}>
            <box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
              <text fg={theme.primary} wrapMode="char" flexGrow={1}>
                {url()}
              </text>
              <text fg={theme.textMuted}>open preview</text>
            </box>
            <text fg={theme.textMuted}>Click to view this {format()} page in Web Preview</text>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
          WebFetch {(props.input as any).url}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function OpenTUIViz(props: ToolProps<typeof OpenTUIVizTool>) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const metadata = props.metadata as any
  const input = props.input as any

  const spec = createMemo(() => metadata?.spec ?? input)
  const title = createMemo(() => String(spec()?.title ?? input?.title ?? "Visualization"))
  const count = createMemo(() => {
    const c = spec()?.components ?? input?.components
    return Array.isArray(c) ? c.length : 0
  })

  // Real-time generative TUI: while the tool arguments are still streaming, the
  // raw JSON accumulates on the pending part. Compile it into a best-effort spec
  // so completed components render incrementally as the model emits them. We also
  // bridge the brief "running" window (after tool-call, before tool-result) by
  // using the now-parsed input — otherwise the user sees the streamed components
  // disappear into a generic "Generating visualization…" placeholder for the
  // lifetime of the tool.
  const live = createMemo(() => {
    if (props.output !== undefined) return undefined
    const state = props.part.state as {
      status: string
      raw?: string
      input?: unknown
    }
    if (state.status === "pending") {
      const raw = state.raw
      if (!raw) return undefined
      const partial = compilePartialSpec(raw)
      return partial.components.length > 0 || partial.title ? partial : undefined
    }
    if (state.status === "running") {
      const parsed = (state.input ?? props.input) as
        | { title?: string; subtitle?: string; components?: unknown }
        | undefined
      if (!parsed) return undefined
      const components = normalizeVizComponents(parsed.components)
      if (components.length === 0 && !parsed.title) return undefined
      return {
        title: typeof parsed.title === "string" ? parsed.title : "",
        subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : undefined,
        components,
        streaming: false,
      }
    }
    return undefined
  })

  const openViz = () => {
    const s = spec()
    if (!s) return
    dialog.replace(() => <DialogOpenTUIViz spec={s} />)
  }

  return (
    <Switch>
      <Match when={props.output !== undefined && count() > 0}>
        <BlockTool
          title={`# Visualization: ${title()}`}
          accentColor={theme.accent ?? theme.primary}
          titleColor={theme.accent ?? theme.primary}
          onClick={openViz}
          part={props.part}
          transparent
        >
          <box gap={1}>
            <box flexDirection="row" justifyContent="space-between" alignItems="center">
              <text fg={theme.accent ?? theme.primary} attributes={TextAttributes.BOLD} flexGrow={1}>
                ◈ {title()}
              </text>
              <text fg={theme.textMuted}>open in TUI ↵</text>
            </box>
            <Show when={spec()?.subtitle}>
              <text fg={theme.textMuted}>{String(spec()?.subtitle)}</text>
            </Show>
            <VizRenderer spec={spec()} />
            <text fg={theme.textMuted}>
              {count()} component{count() === 1 ? "" : "s"} · Click to expand in TUI
            </text>
          </box>
        </BlockTool>
      </Match>
      <Match when={live()}>
        {(partial) => (
          <box
            border
            borderColor={theme.accent ?? theme.primary}
            paddingLeft={1}
            paddingRight={1}
            gap={1}
            flexDirection="column"
          >
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.accent ?? theme.primary} attributes={TextAttributes.BOLD} flexGrow={1}>
                ◈ {partial().title || "Visualization"}
              </text>
              <text fg={theme.warning ?? theme.accent}>● {partial().streaming ? "generating" : "rendering"}</text>
            </box>
            <VizRenderer spec={partial()} loading={partial().streaming} />
            <Show
              when={partial().streaming}
              fallback={
                <text fg={theme.textMuted}>
                  {partial().components.length} component
                  {partial().components.length === 1 ? "" : "s"} ready…
                </text>
              }
            >
              <text fg={theme.textMuted}>
                {partial().components.length} component
                {partial().components.length === 1 ? "" : "s"} streamed…
              </text>
            </Show>
          </box>
        )}
      </Match>
      <Match when={true}>
        <InlineTool icon="◈" pending="Generating visualization..." complete={input?.title} part={props.part}>
          OpenTUI {input?.title ?? ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function CodeSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<any>) {
  const input = props.input as any
  const { theme } = useTheme()
  const dialog = useDialog()
  const output = createMemo(() => String(props.output ?? "").trim())
  const results = createMemo(() => parseWebSearchResults(output()))

  const openPreview = (url: string) => {
    dialog.replace(() => <DialogWebPreview url={url} />)
  }

  const choosePreview = () => {
    if (results().length === 0) return
    if (results().length === 1) {
      openPreview(results()[0]!.url)
      return
    }

    dialog.replace(() => (
      <DialogSelect
        title="Open Web Result"
        placeholder="Filter results"
        options={results().map((result) => ({
          title: result.title,
          description: result.host,
          footer: result.snippet || result.url,
          value: result.url,
          onSelect: (ctx) => {
            ctx.replace(() => <DialogWebPreview url={result.url} />)
          },
        }))}
      />
    ))
  }

  return (
    <Switch>
      <Match when={results().length > 0}>
        <BlockTool
          title={`# Web search: ${input.query}`}
          accentColor={theme.primary}
          titleColor={theme.primary}
          onClick={choosePreview}
          part={props.part}
        >
          <box gap={0}>
            <text fg={theme.textMuted}>
              {results().length} previewable result
              {results().length === 1 ? "" : "s"} found
            </text>
            <text fg={theme.primary} wrapMode="char">
              {results()[0]!.host}
            </text>
            <text fg={theme.textMuted}>
              Click to {results().length === 1 ? "open the result" : "choose a result"} in Web Preview
            </text>
          </box>
        </BlockTool>
      </Match>
      <Match when={output()}>
        <BlockTool title={`# Web search: ${input.query}`} accentColor={theme.primary} part={props.part}>
          <box gap={1}>
            <text fg={theme.textMuted}>Search completed, but no previewable URLs were extracted.</text>
            <text fg={theme.text} wrapMode="word">
              {output().slice(0, 400)}
              {output().length > 400 ? "..." : ""}
            </text>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
          Exa Web Search "{input.query}"
        </InlineTool>
      </Match>
    </Switch>
  )
}

type WebSearchPreviewResult = {
  url: string
  title: string
  snippet: string
  host: string
}

function cleanWebSearchUrl(value: string) {
  return value.replace(/[),.;:!?]+$/, "")
}

function cleanWebSearchLine(value: string) {
  return value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/^[\s>*\-•\d.()#]+/, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function buildWebSearchSnippet(lines: string[]) {
  return lines.map(cleanWebSearchLine).filter(Boolean).join(" ").slice(0, 220)
}

function parseWebSearchResults(output: string): WebSearchPreviewResult[] {
  if (!output.trim()) return []

  const lines = output.split("\n")
  const results: WebSearchPreviewResult[] = []
  const seen = new Set<string>()
  let previousLine = ""

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? ""
    if (!line) continue

    const urlMatch = line.match(/https?:\/\/[^\s<>()\]]+/)
    if (!urlMatch) {
      previousLine = line
      continue
    }

    const url = cleanWebSearchUrl(urlMatch[0])
    if (seen.has(url)) {
      previousLine = line
      continue
    }
    seen.add(url)

    let host = url
    try {
      host = new URL(url).hostname.replace(/^www\./, "")
    } catch {}

    const titleFromLine = cleanWebSearchLine(line)
    const titleFromPrevious = cleanWebSearchLine(previousLine)
    const title = titleFromLine || titleFromPrevious || host

    const snippetLines: string[] = []
    for (let next = index + 1; next < lines.length; next++) {
      const candidate = lines[next]?.trim() ?? ""
      if (!candidate) {
        if (snippetLines.length > 0) break
        continue
      }
      if (/https?:\/\/[^\s<>()\]]+/.test(candidate)) break
      snippetLines.push(candidate)
      if (snippetLines.join(" ").length > 240) break
    }

    results.push({
      url,
      host,
      title,
      snippet: buildWebSearchSnippet(snippetLines),
    })

    if (results.length >= 8) break
    previousLine = line
  }

  if (results.length > 0) return results

  const fallbackUrls = Array.from(output.matchAll(/https?:\/\/[^\s<>()\]]+/g))
  return fallbackUrls.slice(0, 8).map((match) => {
    const url = cleanWebSearchUrl(match[0])
    let host = url
    try {
      host = new URL(url).hostname.replace(/^www\./, "")
    } catch {}
    return {
      url,
      host,
      title: host,
      snippet: "",
    }
  })
}

function formatURLHost(value: string) {
  if (!value) return "web"
  try {
    return new URL(value).hostname.replace(/^www\./, "") || value
  } catch {
    return value
  }
}

function summarizeTaskPreview(text: string) {
  const cleaned = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^<[^>]+>$/.test(line))
  if (cleaned.length === 0) return ""
  const summary = cleaned.slice(-2).join(" ")
  return summary.length > 180 ? summary.slice(0, 177).trimEnd() + "..." : summary
}

type MonitorLogSnapshot = {
  record: {
    id: string
    sessionID: string
    title: string
    command: string
    cwd: string
    logPath: string
    status: string
    wake: boolean
    exitCode?: number
    preview?: string
    time: {
      created: number
      completed?: number
    }
  }
  output: string
  truncated: boolean
}

function trimMonitorBuffer(value: string, maxChars: number = 120_000) {
  if (value.length <= maxChars) return value
  return value.slice(value.length - maxChars)
}

function monitorStatusLabel(status: string, exitCode?: number) {
  switch (status) {
    case "running":
      return "running"
    case "complete":
      return typeof exitCode === "number" ? `completed (exit ${exitCode})` : "completed"
    case "timeout":
      return "timed out"
    case "cancelled":
      return "cancelled"
    case "error":
      return typeof exitCode === "number" ? `failed (exit ${exitCode})` : "failed"
    default:
      return status
  }
}

async function fetchMonitorLog(
  sdk: ReturnType<typeof useSDK>,
  sessionID: string,
  monitorID: string,
  lines: number = 200,
): Promise<MonitorLogSnapshot> {
  const result = await sdk.client.session.monitorLog({
    sessionID,
    monitorID,
    lines,
  })
  if (!result.data) {
    throw new Error(shareErrorMessage(result.error) || "Failed to load monitor log")
  }
  return result.data as MonitorLogSnapshot
}

async function cancelMonitorRequest(sdk: ReturnType<typeof useSDK>, sessionID: string, monitorID: string) {
  const result = await sdk.client.session.monitorCancel({
    sessionID,
    monitorID,
  })
  if (!result.data) {
    throw new Error(shareErrorMessage(result.error) || "Failed to stop monitor")
  }
  return result.data
}

function formatMonitorBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function DialogMonitorLog(props: {
  sessionID: string
  monitorID: string
  title: string
  command: string
  status: string
  logPath?: string
}) {
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const [content, setContent] = createSignal("")
  const [status, setStatus] = createSignal(props.status)
  const [logPath, setLogPath] = createSignal(props.logPath ?? "")
  const [cwd, setCwd] = createSignal("")
  const [createdAt, setCreatedAt] = createSignal<number>()
  const [completedAt, setCompletedAt] = createSignal<number>()
  const [exitCode, setExitCode] = createSignal<number | undefined>()
  const [loading, setLoading] = createSignal(true)
  const [truncated, setTruncated] = createSignal(false)
  const [follow, setFollow] = createSignal(true)
  const [error, setError] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())
  let scrollbox: ScrollBoxRenderable | undefined

  const refresh = async () => {
    setLoading(true)
    try {
      const snapshot = await fetchMonitorLog(sdk, props.sessionID, props.monitorID)
      setContent(trimMonitorBuffer(snapshot.output))
      setStatus(snapshot.record.status)
      setLogPath(snapshot.record.logPath)
      setCwd(snapshot.record.cwd)
      setCreatedAt(snapshot.record.time.created)
      setCompletedAt(snapshot.record.time.completed)
      setExitCode(snapshot.record.exitCode)
      setTruncated(snapshot.truncated)
      setError(undefined)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load monitor log")
    } finally {
      setLoading(false)
    }
  }

  // Elapsed/duration ticker. Only runs while the command is still active so a
  // finished monitor doesn't keep the dialog re-rendering every second.
  createEffect(() => {
    if (status() !== "running") return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const durationMs = createMemo(() => {
    const start = createdAt()
    if (!start) return undefined
    return Math.max(0, (completedAt() ?? now()) - start)
  })

  const statusLine = createMemo(() => {
    const parts = [monitorStatusLabel(status(), exitCode())]
    const duration = durationMs()
    if (duration !== undefined)
      parts.push(`${status() === "running" ? "elapsed" : "duration"} ${Locale.duration(duration)}`)
    if (content().length > 0) parts.push(`${formatMonitorBytes(content().length)} output`)
    return parts.join(" · ")
  })

  const stopMonitor = async () => {
    if (status() !== "running") return
    try {
      await cancelMonitorRequest(sdk, props.sessionID, props.monitorID)
      toast.show({ message: `Stopped ${props.title}`, variant: "info" })
      await refresh()
    } catch (error) {
      toast.show({
        message: friendlyErrorMessage(error, "Failed to stop monitor"),
        variant: "error",
      })
    }
  }

  createEffect(
    on(
      () => content(),
      () => {
        if (!follow()) return
        setTimeout(() => {
          if (scrollbox && !scrollbox.isDestroyed) scrollbox.scrollTo(scrollbox.scrollHeight)
        }, 10)
      },
    ),
  )

  onMount(() => {
    // Self-contained like DialogUsage/DialogAnalytics — don't depend on the
    // caller remembering to size the dialog before opening us.
    dialog.setSize("xlarge")
    void refresh()
    const unsubs = [
      sdk.event.on("monitor.output", (evt) => {
        if (evt.properties.monitorID !== props.monitorID || evt.properties.sessionID !== props.sessionID) return
        setContent((prev) => trimMonitorBuffer(prev + evt.properties.delta))
        setStatus(evt.properties.status)
        setError(undefined)
      }),
      sdk.event.on("monitor.updated", (evt) => {
        if (evt.properties.record.id !== props.monitorID || evt.properties.sessionID !== props.sessionID) return
        setStatus(evt.properties.record.status)
        setExitCode(evt.properties.record.exitCode)
        setLogPath(evt.properties.record.logPath)
      }),
      sdk.event.on("monitor.completed", (evt) => {
        if (evt.properties.monitorID !== props.monitorID || evt.properties.sessionID !== props.sessionID) return
        setStatus(evt.properties.status)
        setExitCode(evt.properties.exitCode ?? undefined)
        void refresh()
      }),
    ]
    onCleanup(() => {
      for (const unsub of unsubs) unsub()
    })
  })

  useKeyboard((evt) => {
    if (evt.ctrl || evt.meta) return
    if (evt.name === "f") {
      evt.preventDefault()
      evt.stopPropagation()
      setFollow((prev) => !prev)
      return
    }
    if (evt.name === "r") {
      evt.preventDefault()
      evt.stopPropagation()
      void refresh()
      return
    }
    if (evt.name === "x") {
      evt.preventDefault()
      evt.stopPropagation()
      void stopMonitor()
      return
    }
    if (evt.name === "c") {
      evt.preventDefault()
      evt.stopPropagation()
      void Clipboard.copy(content())
        .then(() => toast.show({ message: "Monitor log copied", variant: "success" }))
        .catch(() =>
          toast.show({
            message: "Failed to copy monitor log",
            variant: "error",
          }),
        )
    }
  })

  return (
    <box flexDirection="column" width="100%" gap={1}>
      <text fg={theme.text}>Monitor {props.title}</text>
      <text fg={theme.textMuted}>{props.command}</text>
      <text fg={status() === "complete" ? theme.success : status() === "running" ? theme.text : theme.error}>
        {statusLine()}
      </text>
      <Show when={cwd()}>
        <text fg={theme.textMuted}>dir {normalizePath(cwd())}</text>
      </Show>
      <Show when={logPath()}>
        <text fg={theme.textMuted}>log {normalizePath(logPath())}</text>
      </Show>
      <scrollbox
        ref={(value: ScrollBoxRenderable) => {
          scrollbox = value
        }}
        height={Math.max(10, dimensions().height - 18)}
        focused={true}
        border={["top", "bottom", "left", "right"]}
        borderColor={theme.borderSubtle}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.text}>{content() || (loading() ? "Loading log output..." : "No output yet")}</text>
      </scrollbox>
      <Show when={truncated()}>
        <text fg={theme.textMuted}>Showing the latest log window.</text>
      </Show>
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
      <text fg={theme.textMuted}>f follow {follow() ? "on" : "off"} • r refresh • c copy • x stop • esc close</text>
    </box>
  )
}

function Task(props: ToolProps<typeof TaskTool>) {
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const local = useLocal()
  const sync = useSync()

  const meta = createMemo(() => props.metadata as Record<string, any>)
  const input = createMemo(() => props.part.state.input as Record<string, any>)
  const metadataSessionID = createMemo(() =>
    typeof meta().sessionID === "string"
      ? (meta().sessionID as string)
      : typeof meta().sessionId === "string"
        ? (meta().sessionId as string)
        : undefined,
  )
  const rootDelegationID = createMemo(() => {
    if (typeof meta().rootDelegationId === "string") return meta().rootDelegationId as string
    if (typeof meta().delegationId === "string") return meta().delegationId as string
    return undefined
  })
  const isBackground = createMemo(() => Boolean(meta().background || meta().delegationId))
  const kind = createMemo(() => (typeof meta().kind === "string" ? meta().kind : undefined))
  const question = createMemo(() => (typeof meta().question === "string" ? meta().question.trim() : ""))
  const backgroundJob = createMemo(() => {
    const delegationID = rootDelegationID()
    if (!delegationID) return undefined
    return sync.background.get(props.part.sessionID, delegationID)
  })
  const sessionID = createMemo(() => metadataSessionID() ?? backgroundJob()?.workerSessionID)
  const liveSummary = createMemo(() => (typeof meta().liveSummary === "string" ? meta().liveSummary.trim() : ""))
  const derivedLiveSummary = createMemo(() => {
    const child = sessionID()
    if (!child) return ""
    const childMessages = sync.data.message[child] ?? []
    const lastAssistant = childMessages.findLast((message) => message.role === "assistant")
    if (!lastAssistant) return ""
    const parts = sync.data.part[lastAssistant.id] ?? []
    for (let index = parts.length - 1; index >= 0; index--) {
      const part = parts[index]
      if (part.type !== "text" || part.synthetic || part.ignored) continue
      const summary = summarizeTaskPreview(part.text)
      if (summary) return summary
    }
    return ""
  })
  const displaySummary = createMemo(() => liveSummary() || derivedLiveSummary())
  const childStatusLabel = createMemo(() => {
    switch (backgroundJob()?.status) {
      case "running":
        return "running in background"
      case "synthesizing":
        return "synthesizing results"
      case "complete":
        return isBackground() ? "background session ready" : "ready"
      case "cancelled":
        return "background job cancelled"
      case "timeout":
        return "background job timed out"
      case "orphaned":
        return "background job orphaned"
      case "error":
        return "background job errored"
      default:
        return undefined
    }
  })

  const current = createMemo(() => {
    const summary = meta().summary as
      | Array<{
          id: string
          tool: string
          state: { status: string; title?: string }
        }>
      | undefined
    if (!summary || summary.length === 0) return undefined
    for (let i = summary.length - 1; i >= 0; i--) {
      if (summary[i].state.status !== "pending") return summary[i]
    }
    return undefined
  })
  const color = createMemo(() => local.agent.color(input().subagent_type ?? "unknown"))

  // Fall back to metadata.description when the model streamed a title via
  // metadata instead of the `description` parameter (opencode #38100).
  const taskTitle = createMemo(() => {
    const description = input().description
    if (typeof description === "string" && description.trim()) return description
    const metaDesc = meta().description
    if (typeof metaDesc === "string" && metaDesc.trim()) return metaDesc
    return Locale.titlecase(input().subagent_type ?? "unknown")
  })

  return (
    <BlockTool
      title={"# " + taskTitle()}
      titleColor={color()}
      accentColor={color()}
      onClick={
        sessionID()
          ? () =>
              navigate({
                type: "session",
                sessionID: sessionID()!,
                workspaceID: sync.session.get(sessionID()!)?.workspaceID,
              })
          : undefined
      }
      part={props.part}
    >
      <box>
        <text style={{ fg: theme.textMuted }}>
          {input().description}
          <Show when={meta().summary?.length}> ({meta().summary?.length} toolcalls)</Show>
        </text>
        <Show when={kind() === "research" && question()}>
          <text style={{ fg: theme.textMuted }}>└ {question()}</text>
        </Show>
        <Show when={current()}>
          <text
            style={{
              fg: current()!.state.status === "error" ? theme.error : theme.textMuted,
            }}
          >
            └ {Locale.titlecase(current()!.tool)}{" "}
            {current()!.state.status === "completed" ? current()!.state.title : ""}
          </text>
        </Show>
        <Show when={displaySummary()}>
          <text style={{ fg: theme.text }}>└ {displaySummary()}</text>
        </Show>
        <Show
          when={childStatusLabel()}
          fallback={<text style={{ fg: theme.textMuted }}>└ starting background task</text>}
        >
          <text style={{ fg: theme.textMuted }}>└ {childStatusLabel()}</text>
        </Show>
        <Show when={backgroundJob()?.progressSummary && backgroundJob()?.progressSummary !== displaySummary()}>
          <text style={{ fg: theme.textMuted }}>└ {backgroundJob()!.progressSummary}</text>
        </Show>
        <Show when={rootDelegationID() && isBackground()}>
          <text style={{ fg: theme.textMuted }}>└ job {rootDelegationID()}</text>
        </Show>
        <Show when={meta().reused && isBackground()}>
          <text style={{ fg: theme.textMuted }}>└ reused existing background research</text>
        </Show>
      </box>
      <text fg={theme.text}>
        <Show when={sessionID()} fallback={"waiting for background session"}>
          open session
        </Show>
        <span style={{ fg: theme.textMuted }}>{" follow background task"}</span>
      </text>
    </BlockTool>
  )
}

function Monitor(props: ToolProps<typeof MonitorTool>) {
  const { theme } = useTheme()
  const dialog = useDialog()

  const meta = props.metadata as Record<string, any>
  const title = createMemo(() => {
    if (typeof meta.title === "string" && meta.title.trim()) return meta.title.trim()
    if (typeof props.input.title === "string" && props.input.title.trim()) return props.input.title.trim()
    if (typeof props.input.command === "string" && props.input.command.trim()) return props.input.command.trim()
    return "monitor"
  })
  const monitorID = createMemo(() => (typeof meta.monitorId === "string" ? meta.monitorId : undefined))
  const sessionID = createMemo(() => (typeof meta.sessionId === "string" ? meta.sessionId : props.part.sessionID))
  const status = createMemo(() => (typeof meta.status === "string" ? meta.status : "running"))
  const recentOutput = createMemo(() => (typeof meta.recentOutput === "string" ? meta.recentOutput.trim() : ""))
  const exitCode = createMemo(() => (typeof meta.exitCode === "number" ? meta.exitCode : undefined))
  const logPath = createMemo(() => (typeof meta.logPath === "string" ? meta.logPath : undefined))
  const statusColor = createMemo(() => {
    if (status() === "complete") return theme.success
    if (status() === "running") return theme.text
    if (status() === "cancelled") return theme.textMuted
    return theme.error
  })

  const openMonitor = () => {
    if (!monitorID() || !sessionID()) return
    dialog.setSize("xlarge")
    dialog.replace(
      () => (
        <DialogMonitorLog
          sessionID={sessionID()!}
          monitorID={monitorID()!}
          title={title()}
          command={typeof props.input.command === "string" ? props.input.command : meta.command || title()}
          status={status()}
          logPath={logPath()}
        />
      ),
      () => dialog.setSize("medium"),
    )
  }

  return (
    <Switch>
      <Match when={monitorID()}>
        <BlockTool title={`# Monitor ${title()}`} part={props.part} onClick={openMonitor}>
          <box>
            <text style={{ fg: theme.textMuted }}>{props.input.command}</text>
            <text style={{ fg: statusColor() }}>└ {monitorStatusLabel(status(), exitCode())}</text>
            <Show when={recentOutput()}>
              <text style={{ fg: theme.text }}>└ {recentOutput()}</text>
            </Show>
            <Show when={logPath()}>
              <text style={{ fg: theme.textMuted }}>└ {normalizePath(logPath())}</text>
            </Show>
            <Show when={meta.wake === true}>
              <text style={{ fg: theme.textMuted }}>└ wakes the session on completion</text>
            </Show>
          </box>
          <text fg={theme.text}>
            follow logs
            <span style={{ fg: theme.textMuted }}> view monitor output</span>
          </text>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon="◌"
          pending="Starting monitor..."
          complete={props.input.title ?? props.input.command ?? title()}
          part={props.part}
        >
          Monitor {title()}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const view = createMemo(() => {
    const diffStyle = ctx.sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(props.input.filePath))

  const diffContent = createMemo(() => props.metadata.diff)

  const diagnostics = createMemo(() => {
    const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
    const arr = props.metadata.diagnostics?.[filePath] ?? []
    return arr.filter((x: LSP.Diagnostic) => x.severity === 1).slice(0, 3)
  })

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + normalizePath(props.input.filePath!)} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Show when={diagnostics().length}>
            <box>
              <For each={diagnostics()}>
                {(diagnostic) => (
                  <text fg={theme.error}>
                    Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]{" "}
                    {diagnostic.message}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {normalizePath(props.input.filePath!)} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const files = createMemo(() => props.metadata.files ?? [])

  const view = createMemo(() => {
    const diffStyle = ctx.sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return "# Deleted " + file.relativePath
    if (file.type === "add") return "# Created " + file.relativePath
    if (file.type === "move") return "# Moved " + normalizePath(file.filePath) + " → " + file.relativePath
    return "← Patched " + file.relativePath
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={title(file)} part={props.part}>
              <Show
                when={file.type !== "delete"}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                  </text>
                }
              >
                <Diff diff={file.diff} filePath={file.filePath} />
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing apply_patch..." complete={false} part={props.part}>
          apply_patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)

  function format(answer?: readonly string[]) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
