import { createSignal, createEffect, onCleanup, Show, For, onMount, type JSX } from "solid-js"
import { IconButton } from "@nikcli-ai/ui/icon-button"
import { usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { showToast } from "@nikcli-ai/ui/toast"
import {
  type InspectedElement,
  type ConsoleEntry,
  type BridgeMessage,
  INSPECTOR_BRIDGE_SCRIPT,
} from "./inspector-bridge"

export interface BrowserVisualEditorProps {
  initialUrl?: string
  onClose?: () => void
}

type DevicePreset = "responsive" | "desktop" | "tablet" | "mobile"

export function BrowserVisualEditor(props: BrowserVisualEditorProps): JSX.Element {
  const prompt = usePrompt()
  const language = useLanguage()

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

  const navigateTo = (newUrl: string) => {
    let formatted = newUrl.trim()
    if (!formatted) return
    if (!/^https?:\/\//i.test(formatted)) {
      formatted = "http://" + formatted
    }
    setUrl(formatted)
    setInputUrl(formatted)
    setSelectedElement(null)
    setIsLoading(true)
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

      const currentPrompt = prompt.current()
      const existingText = currentPrompt.map((p) => (p.type === "text" ? p.content : "")).join("")

      const newContent = existingText.trim() ? `${existingText.trim()}\n${compressedRef}` : compressedRef

      prompt.set([
        {
          type: "text",
          content: newContent,
          start: 0,
          end: newContent.length,
        },
      ])

      // Auto switch back to browse mode so navigation continues smoothly
      setEditorMode("browse")

      showToast({
        variant: "success",
        title: "Element Linked to Chat",
        description: `<${el.tagName}> (${langUpper}) linked to session prompt.`,
      })
    } else if (data.type === "visual-editor:element-reordered") {
      const reorderNote = `[DOM Reorder: Moved <${data.selector}> from index ${data.oldIndex} to ${data.newIndex} inside <${data.parentSelector}>]\n`

      const currentPrompt = prompt.current()
      const existingText = currentPrompt.map((p) => (p.type === "text" ? p.content : "")).join("")

      const newContent = existingText.trim() ? `${existingText.trim()}\n${reorderNote}` : reorderNote

      prompt.set([
        {
          type: "text",
          content: newContent,
          start: 0,
          end: newContent.length,
        },
      ])

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

    const currentPrompt = prompt.current()
    const existingText = currentPrompt.map((p) => (p.type === "text" ? p.content : "")).join("")

    const newContent = existingText.trim() ? `${existingText.trim()}\n${errorNote}` : errorNote

    prompt.set([
      {
        type: "text",
        content: newContent,
        start: 0,
        end: newContent.length,
      },
    ])

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
    <div class="size-full flex flex-col flex-1 min-h-0 bg-background-base overflow-hidden font-sans">
      {/* Top Browser Toolbar */}
      <div class="h-10 px-2.5 bg-surface-base border-b border-border-weak-base flex items-center justify-between gap-2 shrink-0 select-none overflow-x-auto no-scrollbar">
        {/* Navigation buttons */}
        <div class="flex items-center gap-0.5 shrink-0">
          <IconButton
            icon="arrow-left"
            variant="ghost"
            class="h-6 w-6"
            onClick={() => iframeRef?.contentWindow?.history.back()}
            aria-label="Back"
          />
          <IconButton
            icon="arrow-right"
            variant="ghost"
            class="h-6 w-6"
            onClick={() => iframeRef?.contentWindow?.history.forward()}
            aria-label="Forward"
          />
          <IconButton icon="check-small" variant="ghost" class="h-6 w-6" onClick={handleRefresh} aria-label="Reload" />
        </div>

        {/* URL Bar */}
        <div class="flex-1 min-w-[200px] max-w-lg flex items-center bg-background-base border border-border-weak-base rounded-md px-2 py-0.5 gap-1.5 focus-within:border-primary-base">
          <span class="text-11-medium text-text-weak shrink-0">🌐</span>
          <input
            type="text"
            class="flex-1 min-w-0 bg-transparent text-12-regular text-text-strong focus:outline-none truncate"
            value={inputUrl()}
            onInput={(e) => setInputUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && navigateTo(inputUrl())}
            placeholder="http://localhost:3000"
          />
          <div class="flex items-center gap-0.5 border-l border-border-weak-base pl-1.5 shrink-0">
            {commonPorts.map((port) => (
              <button
                type="button"
                class="px-1.5 py-0.2 text-10-medium rounded bg-surface-subtle hover:bg-surface-elevated text-text-weak hover:text-text-strong cursor-pointer"
                onClick={() => navigateTo(`http://localhost:${port}`)}
              >
                {port}
              </button>
            ))}
          </div>
        </div>

        {/* Action Mode Segmented Controls (Browse vs Edit) */}
        <div class="flex items-center gap-1.5 shrink-0">
          <div class="flex items-center bg-surface-subtle p-0.5 rounded-md border border-border-weak-base">
            <button
              type="button"
              class="px-2.5 py-0.5 text-11-medium rounded transition-colors cursor-pointer flex items-center gap-1"
              classList={{
                "bg-surface-base text-text-strong shadow-xs font-semibold": editorMode() === "browse",
                "text-text-weak hover:text-text-strong": editorMode() !== "browse",
              }}
              onClick={() => setEditorMode("browse")}
              title="Browse Mode: Normal web interaction without interception"
            >
              <span>🧭 Browse</span>
            </button>

            <button
              type="button"
              class="px-2.5 py-0.5 text-11-medium rounded transition-colors cursor-pointer flex items-center gap-1"
              classList={{
                "bg-primary-base text-primary-text shadow-xs font-semibold ring-2 ring-primary-base/40":
                  editorMode() === "edit",
                "text-text-weak hover:text-text-strong": editorMode() !== "edit",
              }}
              onClick={() => setEditorMode(editorMode() === "edit" ? "browse" : "edit")}
              title="Edit Mode: Click to link element into chat, or drag to reorder"
            >
              <span>✏️ Edit</span>
            </button>
          </div>

          {/* Viewport Presets */}
          <div class="flex items-center bg-surface-subtle p-0.5 rounded-md border border-border-weak-base">
            {(["responsive", "tablet", "mobile"] as const).map((p) => (
              <button
                type="button"
                class="px-1.5 py-0.5 text-10-medium rounded transition-colors cursor-pointer capitalize"
                classList={{
                  "bg-surface-base text-text-strong shadow-xs font-semibold": devicePreset() === p,
                  "text-text-weak hover:text-text-strong": devicePreset() !== p,
                }}
                onClick={() => setDevicePreset(p)}
              >
                {deviceDimensions[p].label}
              </button>
            ))}

            <Show when={devicePreset() !== "responsive"}>
              <button
                type="button"
                class="px-1 py-0.5 text-10-medium rounded text-text-weak hover:text-text-strong cursor-pointer"
                onClick={() => setIsLandscape((l) => !l)}
                title="Rotate Orientation"
              >
                🔄
              </button>
            </Show>
          </div>

          {/* Logs Toggle */}
          <button
            type="button"
            class="px-2 py-0.5 text-11-medium rounded-md border border-border-weak-base transition-colors cursor-pointer flex items-center gap-1"
            classList={{
              "bg-surface-elevated text-text-strong font-semibold": consoleOpen(),
              "bg-surface-subtle text-text-weak hover:text-text-strong": !consoleOpen(),
            }}
            onClick={() => setConsoleOpen((o) => !o)}
            title="Toggle Console Logs"
          >
            <span>📟 Logs</span>
            <Show when={errorCount() > 0}>
              <span class="px-1.5 py-0.1 rounded-full bg-red-500/20 text-red-600 font-mono text-10-bold">
                {errorCount()}
              </span>
            </Show>
          </button>

          <Show when={props.onClose}>
            <IconButton icon="close-small" variant="ghost" class="h-6 w-6" onClick={props.onClose} aria-label="Close" />
          </Show>
        </div>
      </div>

      {/* Edit Mode Banner Alert */}
      <Show when={editorMode() === "edit"}>
        <div class="bg-primary-base/15 text-primary-text border-b border-primary-base/30 px-3 py-1 text-11-medium flex items-center justify-between shrink-0 animate-in fade-in duration-100">
          <div class="flex items-center gap-1.5">
            <span>✏️</span>
            <span>
              <strong>Edit Mode Active:</strong> Click any element to link it directly to the chat, or drag it to
              reorder the layout.
            </span>
          </div>
          <button
            type="button"
            class="text-11-regular underline hover:text-text-strong cursor-pointer"
            onClick={() => setEditorMode("browse")}
          >
            Done (Esc)
          </button>
        </div>
      </Show>

      {/* Full Height Viewport Container */}
      <div class="flex-1 min-h-0 w-full h-full flex flex-col relative overflow-hidden bg-background-base">
        <Show
          when={devicePreset() === "responsive"}
          fallback={
            <div class="flex-1 min-h-0 w-full h-full flex items-center justify-center p-4 overflow-auto bg-surface-subtle">
              <div
                class="bg-white rounded-lg border border-border-weak-base overflow-hidden shadow-md flex flex-col shrink-0"
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
                />
              </div>
            </div>
          }
        >
          <iframe
            ref={iframeRef}
            src={url()}
            class="w-full h-full flex-1 min-h-0 border-0 block bg-white"
            style={{ width: "100%", height: "100%", "min-height": "100%", flex: "1 1 0%" }}
            onLoad={injectBridge}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          />
        </Show>
      </div>

      {/* Embedded Console Drawer (Collapsible) */}
      <Show when={consoleOpen()}>
        <div class="h-44 bg-surface-base border-t border-border-weak-base flex flex-col shrink-0 overflow-hidden select-none">
          <div class="h-7 px-3 bg-surface-subtle border-b border-border-weak-base flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-11-semibold text-text-strong">Browser Console</span>
              <div class="flex gap-1">
                {(["all", "error", "warn"] as const).map((f) => (
                  <button
                    type="button"
                    class="px-2 py-0.2 text-10-medium rounded capitalize cursor-pointer"
                    classList={{
                      "bg-surface-base text-text-strong shadow-xs font-semibold": consoleFilter() === f,
                      "text-text-weak hover:text-text-strong": consoleFilter() !== f,
                    }}
                    onClick={() => setConsoleFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="text-10-regular text-text-weak hover:text-text-strong cursor-pointer"
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
              fallback={<div class="text-text-weak italic p-2 text-11-regular">No console messages captured yet.</div>}
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
                      <span class="uppercase text-10-bold opacity-75 shrink-0">[{log.level}]</span>
                      <span class="break-all whitespace-pre-wrap">{log.message}</span>
                    </div>
                    <Show when={log.level === "error"}>
                      <button
                        type="button"
                        class="px-1.5 py-0.5 rounded bg-red-600 text-white text-10-medium shrink-0 hover:bg-red-700 cursor-pointer shadow-xs"
                        onClick={() => sendErrorToAgent(log)}
                        title="Send this error to AI agent to fix"
                      >
                        Ask Agent to Fix
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
