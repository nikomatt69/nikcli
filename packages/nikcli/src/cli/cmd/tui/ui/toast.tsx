import { createContext, useContext, type ParentProps, Show, For } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { GlassBorder } from "../component/border"
import { TextAttributes } from "@opentui/core"
import z from "zod"
import { TuiEvent } from "../event"

// `duration` stays optional at the call site: the zod schema fills the 5000ms
// default at parse time, but the walker types the field as required.
type ToastInput = Omit<z.input<typeof TuiEvent.ToastShow.properties>, "duration"> & { duration?: number }
type ToastParsed = z.output<typeof TuiEvent.ToastShow.properties>
type ToastCurrent = Omit<ToastParsed, "duration">

export type ToastOptions = ToastInput

/** Default toast durations by variant */
export const TOAST_DURATION = {
  info: 3000,
  success: 3000,
  warning: 5000,
  error: 7000,
} as const

const MAX_TOASTS = 3
const TOAST_GAP = 5
const TOAST_BASE_TOP = 2

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <For each={toast.toasts}>
      {(item, index) => (
        <box
          position="absolute"
          justifyContent="center"
          alignItems="flex-start"
          top={TOAST_BASE_TOP + index() * (item.height + TOAST_GAP)}
          right={2}
          maxWidth={Math.min(60, dimensions().width - 6)}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={toastSurface(item.variant, theme).bg}
          borderColor={toastSurface(item.variant, theme).border}
          border={[...GlassBorder.border]}
          customBorderChars={GlassBorder.customBorderChars}
        >
          <box flexDirection="row" gap={1} width="100%" alignItems="center">
            <box width={3} flexShrink={0} alignItems="center" justifyContent="center">
              <text attributes={TextAttributes.BOLD} fg={variantTone(item.variant, theme)}>
                {variantIcon(item.variant)}
              </text>
            </box>
            <box flexDirection="column" gap={0} flexGrow={1} minWidth={0}>
              <Show when={item.title}>
                <text attributes={TextAttributes.BOLD} fg={theme.foreground.default}>
                  {item.title}
                </text>
              </Show>
              <text fg={item.title ? theme.foreground.muted : theme.foreground.default} wrapMode="word" width="100%">
                {item.message}
              </text>
            </box>
          </box>
        </box>
      )}
    </For>
  )
}

function toastSurface(variant: ToastOptions["variant"], theme: ReturnType<typeof useTheme>["theme"]) {
  if (variant === "error" || variant === "warning") {
    return { bg: theme.status[variant].bg, border: theme.status[variant].fg }
  }
  return { bg: theme.surface.overlay, border: theme.border.subtle }
}

function variantTone(variant: ToastOptions["variant"], theme: ReturnType<typeof useTheme>["theme"]) {
  const tones = {
    info: theme.status.info.fg,
    success: theme.status.success.fg,
    warning: theme.status.warning.fg,
    error: theme.status.error.fg,
  }
  return tones[variant] ?? theme.status.info.fg
}

function variantIcon(variant: ToastOptions["variant"]) {
  const icons = {
    info: "[i]",
    success: "[+]",
    warning: "[!]",
    error: "[x]",
  }
  return icons[variant] ?? "[i]"
}

function init() {
  const [store, setStore] = createStore({
    toasts: [] as Array<ToastCurrent & { id: number; height: number }>,
  })

  let nextId = 0

  const toast = {
    show(options: ToastInput) {
      const parsedOptions = TuiEvent.ToastShow.properties.parse(options)
      const { duration, ...currentToast } = parsedOptions

      const id = nextId++
      const height = currentToast.title ? 7 : 5

      setStore("toasts", (prev) => {
        const updated = [...prev, { ...currentToast, id, height }]
        // Keep max MAX_TOASTS
        return updated.slice(-MAX_TOASTS)
      })

      // Auto-remove after duration
      setTimeout(() => {
        setStore("toasts", (prev) => prev.filter((t) => t.id !== id))
      }, duration).unref()
    },
    error(err: unknown) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Something went wrong. Please try again."
      toast.show({
        variant: "error",
        message,
        duration: TOAST_DURATION.error,
      })
    },
    get toasts() {
      return store.toasts
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
