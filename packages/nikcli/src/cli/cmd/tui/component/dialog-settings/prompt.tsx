import { createMemo } from "solid-js"
import { useKV } from "../../context/kv"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

type PromptOption = "show_agent" | "show_model" | "show_shortcuts" | "show_sponsored"

const PROMPT_OPTIONS: { value: PromptOption; title: string; description: string }[] = [
  { value: "show_agent", title: "Show Agent", description: "Display agent name in prompt" },
  { value: "show_model", title: "Show Model", description: "Display model info in prompt" },
  { value: "show_shortcuts", title: "Show Shortcuts", description: "Display keyboard shortcut hints" },
  { value: "show_sponsored", title: "Show Sponsored", description: "Display sponsored tips" },
]

export function DialogSettingsPrompt() {
  const kv = useKV()
  const dialog = useDialog()

  const getValue = (key: PromptOption) => kv.get(key, true)

  const options = createMemo((): DialogSelectOption<PromptOption>[] =>
    PROMPT_OPTIONS.map((opt) => ({
      ...opt,
      title: opt.title,
      value: opt.value,
      description: `${opt.description} (${getValue(opt.value) ? "ON" : "OFF"})`,
    })),
  )

  return (
    <DialogSelect
      title="Prompt Settings"
      options={options()}
      onSelect={(option) => {
        kv.set(option.value, !kv.get(option.value, true))
        dialog.clear()
      }}
    />
  )
}
