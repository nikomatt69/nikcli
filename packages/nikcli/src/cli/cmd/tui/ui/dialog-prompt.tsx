import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
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
  let textarea: TextareaRenderable

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!textarea.isDestroyed && !props.busy) textarea.focus()
    }, 1)
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
        <text attributes={TextAttributes.BOLD} fg={props.busy ? theme.textMuted : theme.text}>
          {props.title}
        </text>
        <Show when={!props.busy}>
          <text fg={theme.textMuted}>esc</text>
        </Show>
      </box>
      <box gap={1}>
        {props.description}
        <Show
          when={!props.busy}
          fallback={
            <box height={3} flexDirection="row" alignItems="center" gap={1}>
              <Spinner>{props.busyText ?? "processing..."}</Spinner>
            </box>
          }
        >
          <textarea
            onSubmit={() => {
              props.onConfirm?.(textarea.plainText)
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
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
          />
        </Show>
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <Show
          when={!props.busy}
          fallback={<text fg={theme.textMuted}>please wait...</text>}
        >
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>submit</span>
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
