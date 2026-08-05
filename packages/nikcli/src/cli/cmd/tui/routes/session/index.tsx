import {
  batch,
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
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useTheme, selectedForeground } from "@tui/context/theme"
import {
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
  RGBA,
} from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { TuiPluginRuntime } from "@tui/plugin"
import {
  createNikcliClient,
  type AssistantMessage,
  type Part,
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
import type { BrowserControlTool } from "@/tool/browser-control"
import type { ComputerTool } from "@/tool/computer"
import type { ArtifactTool } from "@/tool/artifact"

import { normalizeVizComponents } from "@/tool/opentui"
import { LSP } from "@/lsp"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { TodoItem } from "../../component/todo-item"
import { MathMarkdown } from "../../component/math-markdown"
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
import { SubagentFooter } from "./subagent-footer.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript, formatTranscriptJson } from "../../util/transcript"
import { TurnUsage } from "../../util/turn-usage"
import { DialogWebPreview } from "@tui/component/dialog-web-preview"
import {Renderer as VizRenderer } from "@tui/component/dialog-opentui-viz"
import { compilePartialSpec } from "@tui/util/spec-stream"
import { TuiImageList } from "@tui/component/tui-image"
import { DialogSelect } from "../../ui/dialog-select"
import { DialogBgAgents } from "./dialog-bg-agents"
import { features } from "@/config/features"
import { useLanguage } from "@tui/context/language"
import { spacerHeights, visibleRange } from "./message-window"
import {groupParts, type ExplorationGroup } from "./rows"
import { RevertBanner } from "./revert-banner"
import { sessionCommandLabels } from "./session-command-labels"
import {
  dismissBackground as dismissBackgroundUtil,
  getBackgroundDismissed,
  undismissBackground as undismissBackgroundUtil,
} from "../../util/background"
import { friendlyErrorMessage, shareErrorMessage } from "../../util/error-message"
import { Link } from "../../ui/link"
import { context, use } from "./session-context"
import { fromEntries, fromMessages, type Turn, type ViewEntry, type ViewMessage, type ViewPart } from "./view"

/** The file fields the user-message badge row and image preview read. */
type FileAttachment = {
  readonly mime: string
  readonly filename?: string
  readonly url?: string
  readonly source?: { readonly type?: string; readonly path?: string }
}
import { DialogMonitorLog, ExplorationSummary, ToolPartView } from "./tool-view"

addDefaultParsers(parsers.parsers)

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
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
   * The conversation as turns — the seam the renderer draws from.
   *
   * Built from v1 messages and parts today; `fromEntries` produces the same
   * turns from the v2 entry store, and `test/tui/session-view.test.ts` proves
   * the two agree. Swapping the provider is the whole remaining migration.
   */
  const entryRenderer = createMemo(() => features(sync.data.config).tui.entryRenderer)
  const turns = createMemo(() => {
    if (entryRenderer()) {
      return fromEntries((sync.data.entry[route.sessionID] ?? []) as unknown as ViewEntry[])
    }
    return fromMessages(
      messages() as unknown as ViewMessage[],
      (id) => (sync.data.part[id] ?? []) as unknown as ViewPart[],
      toViewEntry,
      toUserEntry,
    )
  })
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
  const streaming = createMemo(() => turns().some((turn) => turn.role === "assistant" && !turn.completedAt))
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
    const all = turns()
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

          const withParts = sessionMessages.map((msg) => ({
            info: msg,
            parts: sync.data.part[msg.id] ?? [],
          }))
          const transcriptOptions = {
            thinking: options.thinking,
            toolDetails: options.toolDetails,
            assistantMetadata: options.assistantMetadata,
          }
          // The filename picks the format — the dialog has always advertised
          // `.json` as an accepted extension, it just never honoured it.
          const format = options.filename.trim().toLowerCase().endsWith(".json") ? "json" : "markdown"
          const transcript =
            format === "json"
              ? formatTranscriptJson(sessionData, withParts, transcriptOptions)
              : formatTranscript(sessionData, withParts, transcriptOptions)

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
              message: `Session exported as ${format} to ${filepath}`,
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
                {(turn, index) => (
                  <Switch>
                    <Match when={revert()?.messageID && turn.messageID >= revert()!.messageID}>
                      <></>
                    </Match>
                    <Match when={turn.role === "user"}>
                      <UserMessage
                        index={windowed().baseIndex + index()}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          dialog.replace(() => (
                            <DialogMessage
                              messageID={turn.messageID}
                              sessionID={route.sessionID}
                              setPrompt={(promptInfo) => prompt.set(promptInfo)}
                            />
                          ))
                        }}
                        turn={turn}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={turn.role === "assistant"}>
                      <AssistantMessage
                        last={lastAssistant()?.id === turn.messageID}
                        turn={turn}
                        usage={turnUsage()?.get(turn.messageID)}
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
              <TuiPluginRuntime.Slot name="session.prompt.top" sessionID={route.sessionID} />
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

/**
 * v1 part → view entry.
 *
 * Structural literals rather than `SessionEntry.fromV1Part`: that module
 * reaches into `MessageV2` and would drag the server graph into the TUI
 * bundle (see specs/startup-performance.md). Field names match the v2 entry
 * shape, so the leaf components read the same keys whichever provider built
 * the turn.
 *
 * The entry keeps the *part's* id here, so element identity is unchanged
 * while v1 is the source.
 */
function toViewEntry(part: ViewPart, _message: ViewMessage): ViewEntry | undefined {
  const base = { id: part.id, sessionID: part.sessionID, messageID: part.messageID, ref: part.id }
  const time = part.time as { start?: number; end?: number } | undefined
  switch (part.type) {
    case "text":
      return { ...base, type: "text", timestamp: time?.start ?? 0, text: String(part.text ?? "") }
    case "reasoning":
      return {
        ...base,
        type: "reasoning",
        timestamp: time?.start ?? 0,
        completed: time?.end,
        text: String(part.text ?? ""),
      }
    case "tool":
      return {
        ...base,
        type: "tool",
        timestamp: time?.start ?? 0,
        callID: part.callID,
        name: part.tool,
        state: part.state,
      }
    default:
      return undefined
  }
}

/** A user message is one entry: its text plus whatever it carried. */
function toUserEntry(message: ViewMessage, parts: readonly ViewPart[]): ViewEntry {
  const text = parts.find((part) => part.type === "text" && !part.synthetic)
  return {
    id: message.id,
    sessionID: message.sessionID,
    messageID: message.id,
    type: "user",
    timestamp: message.time.created,
    text: String(text?.text ?? ""),
    files: parts.filter((part) => part.type === "file"),
  }
}

function UserMessage(props: { turn: Turn; onMouseUp: () => void; index: number; pending?: string }) {
  const ctx = use()
  const local = useLocal()
  /** A user turn is exactly one entry: its text plus what it carried. */
  const entry = createMemo(() => props.turn.body[0])
  const text = createMemo(() => {
    const value = entry()?.text
    return typeof value === "string" && value.length > 0 ? value : undefined
  })
  const files = createMemo(() => (entry()?.files ?? []) as FileAttachment[])
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.turn.messageID > props.pending)
  const color = createMemo(() => local.agent.color(props.turn.request?.agent ?? ""))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())
  const terminalDimensions = useTerminalDimensions()
  const imagePreviewColumns = createMemo(() => Math.max(24, Math.min(180, ctx.width - 8)))
  const imagePreviewRows = createMemo(() => Math.max(4, Math.floor(terminalDimensions().height / 3)))
  const imagePreviewUrls = createMemo(() =>
    files()
      .filter((file) => file.mime.startsWith("image/") && file.mime !== "image/svg+xml")
      .flatMap((file) => (file.url ? [file.url] : file.source?.type === "file" && file.source.path ? [file.source.path] : [])),
  )

  return (
    <>
      <Show when={text() || files().length > 0}>
        <box
          id={props.turn.messageID}
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
            <Show when={text()}>{(value) => <text fg={theme.text}>{value()}</text>}</Show>
            <TuiImageList
              text={text() ?? ""}
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
                      {Locale.todayTimeOrDateTime(props.turn.createdAt)}
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
      <Show when={props.turn.compacted}>
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

function AssistantMessage(props: { turn: Turn; last: boolean; usage?: TurnUsage.Turn }) {
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
  const rows = createMemo<(ViewEntry | ExplorationGroup<ViewEntry>)[]>(() => {
    if (!features(sync.data.config).tui.explorationGrouping) return props.turn.body
    const blocked = new Set(
      (sync.data.permission[props.turn.sessionID] ?? []).flatMap((request) =>
        request.tool?.callID ? [request.tool.callID] : [],
      ),
    )
    return (groupParts as unknown as (
      rows: readonly ViewEntry[],
      options: { closed: boolean; isPending: (entry: ViewEntry) => boolean },
    ) => ({ type: "part"; part: ViewEntry } | ExplorationGroup<ViewEntry>)[])(props.turn.body, {
      closed: Boolean(props.turn.completedAt),
      isPending: (part) => "callID" in part && typeof part.callID === "string" && blocked.has(part.callID),
    }).flatMap<ViewEntry | ExplorationGroup<ViewEntry>>((row) =>
      row.type === "part" ? [row.part] : row.completed ? [row] : row.parts,
    )
  })

  const error = createMemo(() => props.turn.complete?.error as { name?: string } | undefined)

  const final = createMemo(() => {
    const finish = props.turn.complete?.finish
    return finish && !["tool-calls", "unknown"].includes(finish)
  })

  const stats = createMemo(() => {
    // Counted from the prompt that caused the turn — which, in a turn list,
    // is simply the turn before this one.
    const created = props.turn.previousCreatedAt
    if (!created) return null

    const completedAt = props.turn.completedAt ?? Date.now()
    const duration = completedAt - created

    let text = ""
    let streamStart: number | undefined
    let streamEnd: number | undefined

    for (const entry of props.turn.body) {
      if (entry.type !== "text") continue
      text += String(entry.text ?? "")
      if (!entry.timestamp) continue
      streamStart = streamStart === undefined ? entry.timestamp : Math.min(streamStart, entry.timestamp)
      const end = (entry.completed as number | undefined) ?? completedAt
      streamEnd = streamEnd === undefined ? end : Math.max(streamEnd, end)
    }

    if (streamStart === undefined || streamEnd === undefined) {
      return {
        duration,
        tps: 0,
      }
    }

    const streamDuration = Math.max(0, streamEnd - streamStart)
    const reported = props.turn.complete?.outputTokens ?? 0
    const outputTokens = reported > 0 ? reported : Token.estimate(text)

    return {
      duration,
      tps: streamDuration > 0 && outputTokens > 0 ? outputTokens / (streamDuration / 1000) : 0,
    }
  })

  return (
    <>
      <For each={rows()}>
        {(row) => {
          if (row.type === "group") return <ExplorationSummary group={row as never} sessionID={props.turn.sessionID} />
          const component = PART_MAPPING[row.type as keyof typeof PART_MAPPING]
          return (
            <Show when={component}>
              <Dynamic
                last={row === props.turn.body[props.turn.body.length - 1]}
                component={component}
                entry={row as any}
                sessionID={props.turn.sessionID}
              />
            </Show>
          )
        }}
      </For>
      <Show when={error() && error()!.name !== "MessageAbortedError"}>
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
          <text fg={theme.textMuted}>{friendlyErrorMessage(error())}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || error()?.name === "MessageAbortedError"}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span
                style={{
                  fg:
                    error()?.name === "MessageAbortedError"
                      ? theme.textMuted
                      : local.agent.color(props.turn.request?.agent ?? ""),
                }}
              >
                ▣{" "}
              </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.turn.request?.mode ?? "")}</span>
              <span style={{ fg: theme.textMuted }}> · {props.turn.request?.modelID}</span>
              <Show when={stats()}>
                {(value) => (
                  <span style={{ fg: theme.textMuted }}>
                    {" "}
                    · {Locale.duration(value().duration)}
                    <Show when={value().tps > 0}> · {value().tps.toFixed(0)} tok/s</Show>
                  </span>
                )}
              </Show>
              <Show when={error()?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · interrupted</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
      <Show when={props.usage}>{(usage) => <TurnTokens turn={usage()} />}</Show>
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
  tool: ToolPartView,
  reasoning: ReasoningPart,
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

function ReasoningPart(props: { last: boolean; entry: ViewEntry; sessionID: string }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    // Filter out redacted reasoning chunks from OpenRouter
    // OpenRouter sends encrypted reasoning data that appears as [REDACTED]
    return (
      String(props.entry.text ?? "")
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
    const end = (props.entry.completed as number | undefined)
    return end !== undefined
  })
  const duration = createMemo(() => {
    const end = (props.entry.completed as number | undefined)
    if (end === undefined) return
    return Locale.duration(end - props.entry.timestamp)
  })
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.entry.id}
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
            <MathMarkdown
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

function TextPart(props: { last: boolean; entry: ViewEntry; sessionID: string }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const terminalDimensions = useTerminalDimensions()
  const imagePreviewColumns = createMemo(() => Math.max(24, Math.min(180, ctx.width - 8)))
  const imagePreviewRows = createMemo(() => Math.max(4, Math.floor(terminalDimensions().height / 3)))
  const tight = createMemo(() => ctx.width < 84)
  const rendered = createMemo(() => wrapDiagramsInFences(String(props.entry.text ?? "").trim()))

  // O2: streaming tokens-per-sec indicator. Counts chars (4-chars-per-token
  // heuristic) every second, shows the rolling rate as a small badge.
  const streamingSpeed = createStreamingSpeed(rendered, () => !props.last)

  return (
    <Show when={String(props.entry.text ?? "").trim()}>
      <box id={"text-" + props.entry.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <MathMarkdown
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
        <TuiImageList text={String(props.entry.text ?? "")} maxColumns={imagePreviewColumns()} maxRows={imagePreviewRows()} />
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

