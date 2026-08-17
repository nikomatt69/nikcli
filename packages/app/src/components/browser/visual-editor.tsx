import { createSignal, createEffect, createMemo, onCleanup, on, Show, For, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { Icon } from "@nikcli-ai/ui/icon"
import { IconButton } from "@nikcli-ai/ui/icon-button"
import { Select } from "@nikcli-ai/ui/select"
import { usePrompt } from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { showToast } from "@nikcli-ai/ui/toast"
import { getFilename } from "@nikcli-ai/util/path"
import { base64Encode } from "@nikcli-ai/util/encode"
import { persisted } from "@/utils/persist"
import { decode64 } from "@/utils/base64"
import {
  type InspectedElement,
  type ConsoleEntry,
  type BridgeMessage,
  INSPECTOR_BRIDGE_SCRIPT,
} from "./inspector-bridge"

export const VISUAL_EDITOR_PROMPT_EVENT = "nikcli:prompt-append"

export interface BrowserVisualEditorProps {
  initialUrl?: string
  onClose?: () => void
}

function optionalPrompt() {
  try {
    return usePrompt()
  } catch {
    return undefined
  }
}

function appendPromptText(prompt: ReturnType<typeof usePrompt> | undefined, text: string) {
  if (prompt) {
    const currentPrompt = prompt.current()
    const existingText = currentPrompt.map((part) => (part.type === "text" ? part.content : "")).join("")
    const newContent = existingText.trim() ? `${existingText.trim()}\n${text}` : text
    prompt.set([
      {
        type: "text",
        content: newContent,
        start: 0,
        end: newContent.length,
      },
    ])
    return
  }

  window.dispatchEvent(new CustomEvent(VISUAL_EDITOR_PROMPT_EVENT, { detail: text }))
}

type DevicePreset = "responsive" | "desktop" | "tablet" | "mobile"

export function BrowserVisualEditor(props: BrowserVisualEditorProps): JSX.Element {
  const prompt = optionalPrompt()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const params = useParams()
  const navigate = useNavigate()
  const [preview, setPreview] = persisted(
    "visual-editor.preview.v1",
    createStore({ urls: {} as Record<string, string> }),
  )

  // Default to localhost:3000 for user's web app
  const [url, setUrl] = createSignal(props.initialUrl || "http://localhost:3000")
  const [inputUrl, setInputUrl] = createSignal(url())
  const [devicePreset, setDevicePreset] = createSignal<DevicePreset>("responsive")
  const [isLandscape, setIsLandscape] = createSignal(false)
  
  // Unified modes: 'browse' (normal web browsing) | 'edit' (select & link + drag & drop)
  const [editorMode, setEditorMode] = createSignal<"browse" | "edit">("browse")
  const [selectedElement, setSelectedElement] = createSignal<InspectedElement | null>(null)
  const [isLoading, setIsLoading] = createSignal(false)

  // Console drawer state
  const [consoleLogs, setConsoleLogs] = createSignal<ConsoleEntry[]>([])
  const [consoleOpen, setConsoleOpen] = createSignal(false)
  const [consoleFilter, setConsoleFilter] = createSignal<"all" | "error" | "warn">("all")

  let iframeRef: HTMLIFrameElement | undefined

  const deviceDimensions: Record<DevicePreset, { width: string; height: string; label: string }> = {
    responsive: { width: "100%", height: "100%", label: "Full" },
    desktop: { width: "1280px", height: "800px", label: "Desktop" },
    tablet: { width: "768px", height: "1024px", label: "Tablet" },
    mobile: { width: "375px", height: "812px", label: "Mobile" },
  }

  const commonPorts = ["3000", "5173", "8080", "3001"]

  const address = createMemo(() => {
    try {
      const parsed = new URL(url())
      return {
        port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
      }
    } catch {
      return undefined
    }
  })

  const ports = createMemo(() => {
    const current = address()?.port
    if (current && !commonPorts.includes(current) && current !== "80" && current !== "443") {
      return [current, ...commonPorts]
    }
    return commonPorts
  })

  const currentDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const dir = currentDirectory()
    if (!dir) return
    const projects = layout.projects.list()
    const sandbox = projects.find((item) => item.sandboxes?.includes(dir))
    if (sandbox) return sandbox
    return projects.find((item) => item.worktree === dir)
  })
  const worktreeOptions = createMemo(() => {
    const current = project()
    if (!current) return []
    const [main] = globalSync.child(current.worktree, { bootstrap: false })
    const branch = main.vcs?.branch
    const options = [
      {
        value: current.worktree,
        label: branch
          ? language.t("session.new.worktree.mainWithBranch", { branch })
          : language.t("session.new.worktree.main"),
      },
    ]
    for (const sandbox of current.sandboxes ?? []) {
      options.push({ value: sandbox, label: getFilename(sandbox) })
    }
    return options
  })
  const currentWorktree = createMemo(() => {
    const dir = currentDirectory()
    const options = worktreeOptions()
    if (options.some((item) => item.value === dir)) return dir
    return options[0]?.value
  })

  const rememberUrl = (next: string) => {
    const dir = currentDirectory()
    if (!dir) return
    setPreview("urls", dir, next)
  }

  createEffect(
    on(
      () => currentDirectory(),
      (dir) => {
        if (!dir) return
        const saved = preview.urls[dir]
        if (!saved) return
        setUrl(saved)
        setInputUrl(saved)
      },
    ),
  )

  const switchWorktree = (directory: string) => {
    if (!directory || directory === currentDirectory()) return
    rememberUrl(url())
    const saved = preview.urls[directory]
    if (saved) {
      setUrl(saved)
      setInputUrl(saved)
    }
    navigate(`/${base64Encode(directory)}/session`)
  }

  const navigateTo = (newUrl: string) => {
    let formatted = newUrl.trim()
    if (!formatted) return
    if (!/^https?:\/\//i.test(formatted)) {
      formatted = "http://" + formatted
    }
    setUrl(formatted)
    setInputUrl(formatted)
    rememberUrl(formatted)
    setSelectedElement(null)
    setIsLoading(true)
  }

  const switchPort = (port: string) => {
    try {
      const next = new URL(url())
      next.port = port
      navigateTo(next.toString())
    } catch {
      navigateTo(`http://localhost:${port}`)
    }
  }

  const handleRefresh = () => {
    if (iframeRef) {
      setIsLoading(true)
      iframeRef.src = url()
    }
  }

  const injectBridge = () => {
    setIsLoading(false)
    try {
      if (iframeRef && iframeRef.contentWindow) {
        const doc = iframeRef.contentDocument || iframeRef.contentWindow.document
        if (doc) {
          const script = doc.createElement("script")
          script.textContent = INSPECTOR_BRIDGE_SCRIPT
          doc.head?.appendChild(script) || doc.body?.appendChild(script)
        }
      }
    } catch {
      // Cross-origin fallback
    }
  }

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as BridgeMessage
    if (!data || typeof data !== "object") return

    if (data.type === "visual-editor:ready") {
      setIsLoading(false)
      iframeRef?.contentWindow?.postMessage({ type: "visual-editor:set-mode", mode: editorMode() }, "*")
    } else if (data.type === "visual-editor:console-log") {
      setConsoleLogs((prev) => [...prev.slice(-100), data.log])
    } else if (data.type === "visual-editor:element-selected") {
      const el = data.element
      setSelectedElement(el)

      // Format compressed element reference and link it directly to the session chat dock
      const langUpper = el.detectedLanguage.toUpperCase()
      const classPart = el.className ? ` class="${el.className.split(" ").slice(0, 2).join(" ")}"` : ""
      const idPart = el.id ? ` id="${el.id}"` : ""
      
      const compressedRef = `[Element: <${el.tagName}${idPart}${classPart}> (${langUpper}) | selector: "${el.selector}"]\n`
      appendPromptText(prompt, compressedRef)

      // Auto switch back to browse mode so navigation continues smoothly
      setEditorMode("browse")

      showToast({
        variant: "success",
        title: "Element Linked to Chat",
        description: `<${el.tagName}> (${langUpper}) linked to session prompt.`,
      })
    } else if (data.type === "visual-editor:element-reordered") {
      const reorderNote = `[DOM Reorder: Moved <${data.selector}> from index ${data.oldIndex} to ${data.newIndex} inside <${data.parentSelector}>]\n`
      appendPromptText(prompt, reorderNote)

      showToast({
        variant: "success",
        title: "Layout Reordered",
        description: `Element moved in DOM. Instruction added to session prompt.`,
      })
    }
  }

  createEffect(() => {
    window.addEventListener("message", handleMessage)
    onCleanup(() => window.removeEventListener("message", handleMessage))
  })

  // Synchronize editor mode to iframe bridge
  createEffect(() => {
    const mode = editorMode()
    iframeRef?.contentWindow?.postMessage({ type: "visual-editor:set-mode", mode }, "*")
  })

  // Keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === "Escape") {
      setEditorMode("browse")
    }
  }

  createEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown))
  })

  const filteredLogs = () => {
    const filter = consoleFilter()
    const logs = consoleLogs()
    if (filter === "error") return logs.filter((l) => l.level === "error")
    if (filter === "warn") return logs.filter((l) => l.level === "warn" || l.level === "error")
    return logs
  }

  const errorCount = () => consoleLogs().filter((l) => l.level === "error").length

  const sendErrorToAgent = (log: ConsoleEntry) => {
    const errorNote = `[Browser Console Error]:\n${log.message}\n\nPlease analyze this error and fix the code.\n`
    appendPromptText(prompt, errorNote)

    showToast({
      variant: "success",
      title: "Error sent to Agent",
      description: "Console error trace attached to session prompt.",
    })
  }

  const currentWidth = () => {
    const preset = devicePreset()
    const dim = deviceDimensions[preset]
    if (preset === "responsive") return "100%"
    return isLandscape() ? dim.height : dim.width
  }

  const currentHeight = () => {
    const preset = devicePreset()
    const dim = deviceDimensions[preset]
    if (preset === "responsive") return "100%"
    return isLandscape() ? dim.width : dim.height
  }

  return (
    <div class="@container size-full flex flex-col flex-1 min-h-0 bg-background-base overflow-hidden font-sans">
      <div class="shrink-0 bg-surface-base border-b border-border-weak-base select-none">
        <div class="flex items-center gap-1 px-1.5 pt-1.5">
          <div class="flex items-center shrink-0">
            <IconButton
              icon="arrow-left"
              variant="ghost"
              class="h-7 w-7"
              onClick={() => iframeRef?.contentWindow?.history.back()}
              aria-label="Back"
            />
            <IconButton
              icon="arrow-right"
              variant="ghost"
              class="h-7 w-7"
              onClick={() => iframeRef?.contentWindow?.history.forward()}
              aria-label="Forward"
            />
            <IconButton
              icon="check-small"
              variant="ghost"
              class="h-7 w-7"
              onClick={handleRefresh}
              aria-label="Reload"
            />
          </div>

          <form
            class="relative flex min-w-0 flex-1 items-center h-7 bg-background-base border border-border-weak-base rounded-md px-2 gap-1.5 focus-within:border-border-focus"
            onSubmit={(event) => {
              event.preventDefault()
              navigateTo(inputUrl())
            }}
          >
            <Icon name="window-cursor" size="small" class="text-text-weak shrink-0" />
            <input
              type="text"
              class="flex-1 min-w-0 bg-transparent text-12-regular text-text-strong focus:outline-none"
              value={inputUrl()}
              onInput={(e) => setInputUrl(e.currentTarget.value)}
              placeholder="localhost:3000"
              aria-label="Preview URL"
            />
            <div class="hidden @[22rem]:flex items-center gap-0.5 min-w-0 max-w-[42%] overflow-x-auto no-scrollbar border-l border-border-weak-base pl-1.5">
              <For each={ports()}>
                {(port) => (
                  <button
                    type="button"
                    class="h-5 px-1.5 text-10-medium rounded cursor-pointer shrink-0"
                    classList={{
                      "bg-surface-base text-text-strong": address()?.port === port,
                      "text-text-weak hover:text-text-strong hover:bg-surface-subtle": address()?.port !== port,
                    }}
                    onClick={() => switchPort(port)}
                  >
                    {port}
                  </button>
                )}
              </For>
            </div>
            <Show when={isLoading()}>
              <div class="absolute inset-x-1 bottom-0 h-px bg-primary-base/80" />
            </Show>
          </form>

          <Show when={props.onClose}>
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-7 w-7 shrink-0"
              onClick={props.onClose}
              aria-label="Close"
            />
          </Show>
        </div>

        <div class="flex items-center gap-1 px-1.5 py-1.5 min-w-0 overflow-x-auto no-scrollbar">
          <div class="flex items-center bg-surface-subtle p-0.5 rounded-md border border-border-weak-base shrink-0">
            <button
              type="button"
              class="h-6 px-2 rounded text-11-medium cursor-pointer flex items-center gap-1"
              classList={{
                "bg-surface-base text-text-strong font-medium": editorMode() === "browse",
                "text-text-weak hover:text-text-strong": editorMode() !== "browse",
              }}
              aria-pressed={editorMode() === "browse"}
              onClick={() => setEditorMode("browse")}
              title="Browse the page"
            >
              <Icon name="eye" size="small" />
              <span>Browse</span>
            </button>
            <button
              type="button"
              class="h-6 px-2 rounded text-11-medium cursor-pointer flex items-center gap-1"
              classList={{
                "bg-primary-base text-primary-text font-medium": editorMode() === "edit",
                "text-text-weak hover:text-text-strong": editorMode() !== "edit",
              }}
              aria-pressed={editorMode() === "edit"}
              onClick={() => setEditorMode(editorMode() === "edit" ? "browse" : "edit")}
              title="Select elements to send to chat"
            >
              <Icon name="pencil-line" size="small" />
              <span>Edit</span>
            </button>
          </div>

          <Show when={worktreeOptions().length > 0}>
            <Select
              options={worktreeOptions()}
              current={worktreeOptions().find((item) => item.value === currentWorktree())}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => item && switchWorktree(item.value)}
              variant="secondary"
              size="small"
              placeholder={language.t("visualEditor.worktree.label")}
              class="shrink-0 max-w-[11rem]"
            />
          </Show>

          <div class="@[22rem]:hidden flex-1 min-w-0 overflow-x-auto no-scrollbar">
            <div class="flex items-center gap-0.5 w-max">
              <For each={ports()}>
                {(port) => (
                  <button
                    type="button"
                    class="h-6 px-1.5 text-10-medium rounded cursor-pointer shrink-0"
                    classList={{
                      "bg-surface-subtle text-text-strong": address()?.port === port,
                      "text-text-weak hover:text-text-strong": address()?.port !== port,
                    }}
                    onClick={() => switchPort(port)}
                  >
                    {port}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="ml-auto flex items-center gap-1 min-w-0">
            <div class="flex items-center bg-surface-subtle p-0.5 rounded-md border border-border-weak-base">
              <For each={["responsive", "tablet", "mobile"] as const}>
                {(preset) => (
                  <button
                    type="button"
                    class="h-6 px-1.5 text-10-medium rounded cursor-pointer"
                    classList={{
                      "bg-surface-base text-text-strong font-medium": devicePreset() === preset,
                      "text-text-weak hover:text-text-strong": devicePreset() !== preset,
                    }}
                    onClick={() => setDevicePreset(preset)}
                  >
                    {deviceDimensions[preset].label}
                  </button>
                )}
              </For>
              <Show when={devicePreset() !== "responsive"}>
                <button
                  type="button"
                  class="h-6 w-6 grid place-items-center rounded text-text-weak hover:text-text-strong cursor-pointer"
                  onClick={() => setIsLandscape((value) => !value)}
                  title="Rotate orientation"
                  aria-label="Rotate orientation"
                >
                  <Icon name="chevron-grabber-vertical" size="small" />
                </button>
              </Show>
            </div>

            <button
              type="button"
              class="h-7 px-2 rounded-md border border-border-weak-base cursor-pointer flex items-center gap-1 text-11-medium shrink-0"
              classList={{
                "bg-surface-base text-text-strong": consoleOpen(),
                "bg-surface-subtle text-text-weak hover:text-text-strong": !consoleOpen(),
              }}
              onClick={() => setConsoleOpen((open) => !open)}
              title="Toggle console"
              aria-pressed={consoleOpen()}
            >
              <Icon name="console" size="small" />
              <span class="hidden @[28rem]:inline">Logs</span>
              <Show when={errorCount() > 0}>
                <span class="min-w-4 px-1 rounded-full bg-red-500/20 text-red-600 font-mono text-10-medium text-center">
                  {errorCount()}
                </span>
              </Show>
            </button>
          </div>
        </div>
      </div>

      <Show when={editorMode() === "edit"}>
        <div class="bg-primary-base/12 text-primary-text border-b border-primary-base/25 px-2.5 py-1 text-11-medium flex items-center gap-2 shrink-0 min-w-0">
          <Icon name="pencil-line" size="small" class="shrink-0" />
          <span class="min-w-0 truncate">
            <span class="hidden @md:inline">Edit mode — click to link an element, drag to reorder.</span>
            <span class="@md:hidden">Click to link, drag to reorder.</span>
          </span>
          <button
            type="button"
            class="ml-auto shrink-0 text-11-regular underline hover:text-text-strong cursor-pointer"
            onClick={() => setEditorMode("browse")}
          >
            Done
          </button>
        </div>
      </Show>

      <div class="flex-1 min-h-0 w-full flex flex-col relative overflow-hidden bg-background-base">
        <Show
          when={devicePreset() === "responsive"}
          fallback={
            <div class="flex-1 min-h-0 w-full flex items-center justify-center p-3 overflow-auto bg-surface-subtle">
              <div
                class="bg-white rounded-lg border border-border-weak-base overflow-hidden flex flex-col min-w-0 min-h-0"
                style={{
                  width: currentWidth(),
                  height: currentHeight(),
                  "max-height": "100%",
                  "max-width": "100%",
                }}
              >
                <iframe
                  ref={iframeRef}
                  src={url()}
                  class="w-full h-full flex-1 min-h-0 border-0 block bg-white"
                  onLoad={injectBridge}
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                  title="Visual editor preview"
                />
              </div>
            </div>
          }
        >
          <iframe
            ref={iframeRef}
            src={url()}
            class="w-full h-full flex-1 min-h-0 border-0 block bg-white"
            onLoad={injectBridge}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            title="Visual editor preview"
          />
        </Show>
      </div>

      <Show when={consoleOpen()}>
        <div class="h-36 @md:h-44 max-h-[38%] min-h-28 bg-surface-base border-t border-border-weak-base flex flex-col shrink-0 overflow-hidden select-none">
          <div class="h-7 px-2 @md:px-3 bg-surface-subtle border-b border-border-weak-base flex items-center justify-between gap-2 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-11-medium text-text-strong shrink-0">Console</span>
              <div class="flex gap-0.5">
                <For each={["all", "error", "warn"] as const}>
                  {(filter) => (
                    <button
                      type="button"
                      class="px-1.5 h-5 text-10-medium rounded capitalize cursor-pointer"
                      classList={{
                        "bg-surface-base text-text-strong": consoleFilter() === filter,
                        "text-text-weak hover:text-text-strong": consoleFilter() !== filter,
                      }}
                      onClick={() => setConsoleFilter(filter)}
                    >
                      {filter}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                class="text-10-regular text-text-weak hover:text-text-strong cursor-pointer px-1"
                onClick={() => setConsoleLogs([])}
              >
                Clear
              </button>
              <IconButton
                icon="close-small"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => setConsoleOpen(false)}
                aria-label="Close console"
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-2 font-mono text-11-regular flex flex-col gap-1">
            <Show
              when={filteredLogs().length > 0}
              fallback={<div class="text-text-weak p-2 text-11-regular">No console messages yet.</div>}
            >
              <For each={filteredLogs()}>
                {(log) => (
                  <div
                    class="px-2 py-1 rounded flex items-start justify-between gap-2"
                    classList={{
                      "bg-red-500/10 text-red-600 border border-red-500/20": log.level === "error",
                      "bg-amber-500/10 text-amber-600 border border-amber-500/20": log.level === "warn",
                      "bg-surface-subtle text-text-strong": log.level === "log" || log.level === "info",
                    }}
                  >
                    <div class="flex items-start gap-2 min-w-0 flex-1">
                      <span class="uppercase text-10-medium opacity-75 shrink-0">[{log.level}]</span>
                      <span class="break-all whitespace-pre-wrap">{log.message}</span>
                    </div>
                    <Show when={log.level === "error"}>
                      <button
                        type="button"
                        class="px-1.5 py-0.5 rounded bg-red-600 text-white text-10-medium shrink-0 hover:bg-red-700 cursor-pointer"
                        onClick={() => sendErrorToAgent(log)}
                        title="Send this error to the agent"
                      >
                        <span class="hidden @md:inline">Ask agent</span>
                        <span class="@md:hidden">Fix</span>
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
