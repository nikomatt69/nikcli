import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export type DialogExportOptionsProps = {
  defaultFilename: string
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  defaultOpenWithoutSaving: boolean
  onConfirm?: (options: {
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  }) => void
  onCancel?: () => void
}

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable
  const [store, setStore] = createStore({
    thinking: props.defaultThinking,
    toolDetails: props.defaultToolDetails,
    assistantMetadata: props.defaultAssistantMetadata,
    openWithoutSaving: props.defaultOpenWithoutSaving,
    active: "filename" as "filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving",
  })

  useKeyboard((evt) => {
    if (evt.name === "return") {
      const filename = textarea.plainText.trim()
      if (!filename) return
      props.onConfirm?.({
        filename,
        thinking: store.thinking,
        toolDetails: store.toolDetails,
        assistantMetadata: store.assistantMetadata,
        openWithoutSaving: store.openWithoutSaving,
      })
    }
    if (evt.name === "tab") {
      const order: Array<"filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving"> = [
        "filename",
        "thinking",
        "toolDetails",
        "assistantMetadata",
        "openWithoutSaving",
      ]
      const currentIndex = order.indexOf(store.active)
      const nextIndex = (currentIndex + 1) % order.length
      setStore("active", order[nextIndex])
      evt.preventDefault()
    }
    if (evt.name === "space") {
      if (store.active === "thinking") setStore("thinking", !store.thinking)
      if (store.active === "toolDetails") setStore("toolDetails", !store.toolDetails)
      if (store.active === "assistantMetadata") setStore("assistantMetadata", !store.assistantMetadata)
      if (store.active === "openWithoutSaving") setStore("openWithoutSaving", !store.openWithoutSaving)
      evt.preventDefault()
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    queueMicrotask(() => {
      if (!textarea.isDestroyed && !textarea.focused) {
        textarea.focus()
      }
    })
    textarea.gotoLineEnd()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.foreground.default}>
          Export Options
        </text>
        <text fg={theme.foreground.muted}>esc</text>
      </box>
      <box gap={1}>
        <box>
          <text fg={theme.foreground.default}>Filename:</text>
        </box>
        <textarea
          onSubmit={() => {
            const filename = textarea.plainText.trim()
            if (!filename) return
            props.onConfirm?.({
              filename,
              thinking: store.thinking,
              toolDetails: store.toolDetails,
              assistantMetadata: store.assistantMetadata,
              openWithoutSaving: store.openWithoutSaving,
            })
          }}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.defaultFilename}
          placeholder="Enter filename (.md, .txt, .json)"
          textColor={theme.foreground.default}
          focusedTextColor={theme.foreground.default}
          cursorColor={theme.foreground.default}
        />
      </box>
      <box flexDirection="column">
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "thinking" ? theme.surface.offset : undefined}
          onMouseUp={() => setStore("active", "thinking")}
        >
          <text fg={store.active === "thinking" ? theme.accent.fg : theme.foreground.muted}>
            {store.thinking ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "thinking" ? theme.accent.fg : theme.foreground.default}>Include thinking</text>
        </box>
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "toolDetails" ? theme.surface.offset : undefined}
          onMouseUp={() => setStore("active", "toolDetails")}
        >
          <text fg={store.active === "toolDetails" ? theme.accent.fg : theme.foreground.muted}>
            {store.toolDetails ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "toolDetails" ? theme.accent.fg : theme.foreground.default}>
            Include tool details
          </text>
        </box>
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "assistantMetadata" ? theme.surface.offset : undefined}
          onMouseUp={() => setStore("active", "assistantMetadata")}
        >
          <text fg={store.active === "assistantMetadata" ? theme.accent.fg : theme.foreground.muted}>
            {store.assistantMetadata ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "assistantMetadata" ? theme.accent.fg : theme.foreground.default}>
            Include assistant metadata
          </text>
        </box>
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "openWithoutSaving" ? theme.surface.offset : undefined}
          onMouseUp={() => setStore("active", "openWithoutSaving")}
        >
          <text fg={store.active === "openWithoutSaving" ? theme.accent.fg : theme.foreground.muted}>
            {store.openWithoutSaving ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "openWithoutSaving" ? theme.accent.fg : theme.foreground.default}>
            Open without saving
          </text>
        </box>
      </box>
      <Show when={store.active !== "filename"}>
        <box flexDirection="row" flexWrap="wrap" gap={1} paddingBottom={1}>
          <text fg={theme.foreground.muted}>space</text>
          <text fg={theme.foreground.muted}>toggle</text>
          <text fg={theme.border.subtle}>·</text>
          <text fg={theme.foreground.muted}>return</text>
          <text fg={theme.foreground.muted}>confirm</text>
        </box>
      </Show>
      <Show when={store.active === "filename"}>
        <box flexDirection="row" flexWrap="wrap" gap={1} paddingBottom={1}>
          <text fg={theme.foreground.muted}>return</text>
          <text fg={theme.foreground.muted}>confirm</text>
          <text fg={theme.border.subtle}>·</text>
          <text fg={theme.foreground.muted}>tab</text>
          <text fg={theme.foreground.muted}>options</text>
        </box>
      </Show>
    </box>
  )
}

DialogExportOptions.show = (
  dialog: DialogContext,
  defaultFilename: string,
  defaultThinking: boolean,
  defaultToolDetails: boolean,
  defaultAssistantMetadata: boolean,
  defaultOpenWithoutSaving: boolean,
) => {
  return new Promise<{
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  } | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogExportOptions
          defaultFilename={defaultFilename}
          defaultThinking={defaultThinking}
          defaultToolDetails={defaultToolDetails}
          defaultAssistantMetadata={defaultAssistantMetadata}
          defaultOpenWithoutSaving={defaultOpenWithoutSaving}
          onConfirm={(options) => resolve(options)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}
