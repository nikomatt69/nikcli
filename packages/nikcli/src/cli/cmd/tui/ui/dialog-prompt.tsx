import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { useKeybind } from "@tui/context/keybind"
import { createEffect, onMount, Show, type JSX } from "solid-js"
import { Spinner } from "../component/spinner"

export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  busy?: boolean
  busyText?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()
  let textarea: TextareaRenderable

  const submitKey = () => keybind.print("input_submit") || "enter"

  onMount(() => {
    dialog.setSize("medium")
    queueMicrotask(() => {
      if (!textarea.isDestroyed && !textarea.focused && !props.busy) {
        textarea.focus()
      }
    })
    textarea.gotoLineEnd()
  })

  createEffect(() => {
    if (props.busy) {
      if (!textarea.isDestroyed) textarea.blur()
    } else {
      if (!textarea.isDestroyed) textarea.focus()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={props.busy ? theme.foreground.muted : theme.foreground.default}>
          {props.title}
        </text>
        <Show when={!props.busy}>
          <text fg={theme.foreground.muted}>esc</text>
        </Show>
      </box>
      <box gap={1}>
        {props.description?.()}
        <Show
          when={!props.busy}
          fallback={
            <box height={3} flexDirection="row" alignItems="center" gap={1}>
              <Spinner>{props.busyText ?? "Processing…"}</Spinner>
            </box>
          }
        >
          <textarea
            onSubmit={() => {
              const val = textarea.plainText.trim()
              if (!val) {
                return
              }
              props.onConfirm?.(val)
            }}
            onKeyPress={(evt) => {
              if (props.busy) {
                evt.preventDefault()
              }
            }}
            height={3}
            keyBindings={[{ name: "return", action: "submit" }]}
            ref={(val: TextareaRenderable) => (textarea = val)}
            initialValue={props.value}
            placeholder={props.placeholder ?? "Enter text"}
            textColor={theme.foreground.default}
            focusedTextColor={theme.foreground.default}
            cursorColor={theme.foreground.default}
          />
        </Show>
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <Show when={!props.busy} fallback={<text fg={theme.foreground.muted}>Please wait…</text>}>
          <text fg={theme.foreground.default}>
            <span style={{ fg: theme.accent.fg }}>{submitKey()}</span>{" "}
            <span style={{ fg: theme.foreground.muted }}>submit</span>
          </text>
        </Show>
      </box>
    </box>
  )
}

DialogPrompt.show = (dialog: DialogContext, title: string, options?: Omit<DialogPromptProps, "title">) => {
  return new Promise<string | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} onCancel={() => resolve(null)} />
      ),
      () => resolve(null),
    )
  })
}
