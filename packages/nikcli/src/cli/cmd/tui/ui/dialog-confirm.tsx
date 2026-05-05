import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Locale } from "@/util/locale"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  /** Which button should be focused by default. Defaults to "cancel" for safety. */
  defaultFocus?: "confirm" | "cancel"
}

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    active: (props.defaultFocus ?? "cancel") as "confirm" | "cancel",
  })

  useKeyboard((evt) => {
    if (evt.name === "return") {
      if (store.active === "confirm") props.onConfirm?.()
      if (store.active === "cancel") props.onCancel?.()
      dialog.clear()
    }

    // Y/N shortcuts for quick confirm/cancel
    if (evt.name === "y" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      props.onConfirm?.()
      dialog.clear()
      return
    }
    if (evt.name === "n" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      props.onCancel?.()
      dialog.clear()
      return
    }

    if (evt.name === "left" || evt.name === "right") {
      setStore("active", store.active === "confirm" ? "cancel" : "confirm")
    }
  })
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} gap={2}>
        <For each={["cancel", "confirm"]}>
          {(key) => (
            <box
              paddingLeft={4}
              paddingRight={4}
              paddingTop={1}
              paddingBottom={1}
              border={true}
              borderColor={key === store.active ? theme.borderActive : theme.border}
              backgroundColor={key === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm?.()
                if (key === "cancel") props.onCancel?.()
                dialog.clear()
              }}
            >
              <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>
                {Locale.titlecase(key)}
              </text>
            </box>
          )}
        </For>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <text fg={theme.textMuted}>
          Y/N or <span style={{ fg: theme.text }}>←→</span> to switch, <span style={{ fg: theme.text }}>enter</span> to
          confirm
        </text>
      </box>
    </box>
  )
}

DialogConfirm.show = (dialog: DialogContext, title: string, message: string, defaultFocus?: "confirm" | "cancel") => {
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          defaultFocus={defaultFocus}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
        />
      ),
      () => resolve(false),
    )
  })
}
