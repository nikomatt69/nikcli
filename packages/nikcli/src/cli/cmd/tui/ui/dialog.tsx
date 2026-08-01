import { useKeyboard, useRenderer, useTerminalDimensions, useTimeline } from "@opentui/solid"
import {
  batch,
  createContext,
  createSignal,
  onCleanup,
  onMount,
  Show,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Renderable, RGBA } from "@opentui/core"
import { createStore } from "solid-js/store"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "./toast"

/**
 * Gap convention for dialog layouts:
 * - Container gap: 2 (between major sections)
 * - List rows gap: 1 (between items)
 * - Button spacing: gap=2 for grouped buttons
 */
export type DialogSize = "medium" | "large" | "xlarge" | "full"
type DialogElement = JSX.Element | (() => JSX.Element)
type DialogEntry = {
  element: DialogElement
  onClose?: () => void
}

export function Dialog(
  props: ParentProps<{
    size?: DialogSize
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const timeline = useTimeline()

  const [opacity, setOpacity] = createSignal(0)

  onMount(() => {
    timeline.add(
      { opacity: 0 },
      { opacity: 1, duration: 150, ease: "outQuad", onUpdate: (a) => setOpacity(a.targets[0].opacity) },
    )
  })

  const width = () => {
    const dims = dimensions()
    // `full` is for dialogs whose *content* is the window — the browser
    // surface, where every column is a pixel of horizontal resolution and a
    // 120-column cap is a cap on how much page you can see.
    if (props.size === "full") return Math.max(1, dims.width - 4)
    if (props.size === "xlarge") return Math.min(120, Math.max(1, dims.width - 8))
    if (props.size === "large") return Math.min(88, Math.max(1, dims.width - 6))
    return Math.min(60, Math.max(1, dims.width - 4))
  }

  return (
    <box
      onMouseUp={async () => {
        if (renderer.getSelection()) return
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      justifyContent="center"
      position="absolute"
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, Math.round(150 * opacity()))}
    >
      <box
        onMouseUp={async (e) => {
          if (renderer.getSelection()) return
          e.stopPropagation()
        }}
        width={width()}
        maxWidth={Math.max(1, dimensions().width - 4)}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        {props.children}
      </box>
    </box>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as DialogEntry[],
    size: "medium" as DialogSize,
  })

  function closeCallbacks() {
    return store.stack.map((item) => item.onClose).filter((callback): callback is () => void => Boolean(callback))
  }

  function runCloseCallbacks(callbacks: (() => void)[]) {
    for (const callback of callbacks) {
      callback()
    }
  }

  function closeTop() {
    const current = store.stack.at(-1)
    if (!current) return
    const next = store.stack.slice(0, -1)
    batch(() => {
      if (next.length === 0) setStore("size", "medium")
      setStore("stack", next)
    })
    current.onClose?.()
    refocus()
  }

  useKeyboard((evt) => {
    // Escape closes only the top dialog
    if (evt.name === "escape" && store.stack.length > 0) {
      closeTop()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    // Ctrl+C closes entire stack if in non-interactive top-level dialog
    // (e.g., alert, confirm), otherwise propagate to interrupt AI response
    if (evt.ctrl && evt.name === "c") {
      if (store.stack.length > 0) {
        // Check if top dialog is interactive (has textarea/input focused)
        const topElement = store.stack.at(-1)?.element
        const isInteractive =
          typeof topElement === "function" &&
          String(topElement).includes("textarea") &&
          document.activeElement?.tagName !== "TEXTAREA"

        if (!isInteractive) {
          // Clear entire stack for non-interactive dialogs
          const callbacks = closeCallbacks()
          batch(() => {
            setStore("size", "medium")
            setStore("stack", [])
          })
          runCloseCallbacks(callbacks)
          evt.preventDefault()
          evt.stopPropagation()
        }
        // Otherwise, let the event propagate (e.g., to interrupt AI)
      }
    }
  })

  const renderer = useRenderer()
  let focus: Renderable | null
  let refocusTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (refocusTimer) clearTimeout(refocusTimer)
  })

  function refocus() {
    if (refocusTimer) clearTimeout(refocusTimer)
    refocusTimer = setTimeout(() => {
      if (!focus) return
      if (focus.isDestroyed) return
      function find(item: Renderable) {
        for (const child of item.getChildren()) {
          if (child === focus) return true
          if (find(child)) return true
        }
        return false
      }
      const found = find(renderer.root)
      if (!found) return
      focus.focus()
      // Second pass: some dialogs unmount asynchronously; reclaim once more.
      setTimeout(() => {
        if (!focus || focus.isDestroyed) return
        if (!focus.focused) focus.focus()
      }, 30)
    }, 1)
  }

  return {
    clear() {
      // Collect onClose callbacks BEFORE updating store to avoid recursion
      const callbacks = closeCallbacks()
      batch(() => {
        setStore("size", "medium")
        setStore("stack", [])
      })
      // Call onClose callbacks AFTER store update to prevent recursive loops
      runCloseCallbacks(callbacks)
      refocus()
    },
    replace(input: DialogElement, onClose?: () => void) {
      // Collect onClose callbacks BEFORE updating store to avoid recursion
      const callbacks = closeCallbacks()
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("stack", [
          {
            element: input,
            onClose,
          },
        ])
      })
      // Call onClose callbacks AFTER store update to prevent recursive loops
      runCloseCallbacks(callbacks)
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    setSize(size: DialogSize) {
      setStore("size", size)
    },
  }
}

function DialogContent(props: { entry: DialogEntry }) {
  return <>{typeof props.entry.element === "function" ? props.entry.element() : props.entry.element}</>
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        onMouseUp={async () => {
          const text = renderer.getSelection()?.getSelectedText()
          if (text && text.length > 0) {
            await Clipboard.copy(text)
              .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
              .catch(toast.error)
            renderer.clearSelection()
          }
        }}
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size}>
            <DialogContent entry={value.stack.at(-1)!} />
          </Dialog>
        </Show>
      </box>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
