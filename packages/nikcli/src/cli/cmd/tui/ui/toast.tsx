import { createContext, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { GlassBorderLight } from "../component/border"
import { TextAttributes } from "@opentui/core"
import z from "zod"
import { TuiEvent } from "../event"

type ToastInput = z.input<typeof TuiEvent.ToastShow.properties>
type ToastParsed = z.output<typeof TuiEvent.ToastShow.properties>
type ToastCurrent = Omit<ToastParsed, "duration">

export type ToastOptions = ToastInput

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <Show when={toast.currentToast}>
      {(current) => {
        const tone = variantTone(current().variant, theme)
        const icon = variantIcon(current().variant)
        const messageColor = current().title ? theme.textMuted : theme.text
        return (
          <box
            position="absolute"
            justifyContent="center"
            alignItems="flex-start"
            top={2}
            right={2}
            maxWidth={Math.min(60, dimensions().width - 6)}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.backgroundPanel}
            borderColor={theme.borderSubtle}
            border={[...GlassBorderLight.border]}
            customBorderChars={GlassBorderLight.customBorderChars}
          >
            <box flexDirection="row" gap={1} width="100%" alignItems="center">
              <box width={3} flexShrink={0} alignItems="center" justifyContent="center">
                <text attributes={TextAttributes.BOLD} fg={tone}>
                  {icon}
                </text>
              </box>
              <box flexDirection="column" gap={0} flexGrow={1} minWidth={0}>
                <Show when={current().title}>
                  <text attributes={TextAttributes.BOLD} fg={theme.text}>
                    {current().title}
                  </text>
                </Show>
                <text fg={messageColor} wrapMode="word" width="100%">
                  {current().message}
                </text>
              </box>
            </box>
          </box>
        )
      }}
    </Show>
  )
}

function variantTone(variant: ToastOptions["variant"], theme: ReturnType<typeof useTheme>["theme"]) {
  const tones = {
    info: theme.info,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
  }
  return tones[variant] ?? theme.info
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
    currentToast: null as ToastCurrent | null,
  })

  let timeoutHandle: NodeJS.Timeout | null = null

  const toast = {
    show(options: ToastInput) {
      const parsedOptions = TuiEvent.ToastShow.properties.parse(options)
      const { duration, ...currentToast } = parsedOptions
      setStore("currentToast", currentToast)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, duration).unref()
    },
    error: (err: any) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    get currentToast(): ToastCurrent | null {
      return store.currentToast
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
