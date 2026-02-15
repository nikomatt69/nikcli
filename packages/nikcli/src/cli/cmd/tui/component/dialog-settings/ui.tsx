import { createMemo } from "solid-js"
import { useKV } from "../../context/kv"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

type UIOption = "animations" | "timestamps" | "thinking" | "tool_details" | "scrollbar"

const UI_OPTIONS: { value: UIOption; title: string; key: string; defaultValue: boolean | "hide" | "show" }[] = [
  { value: "animations", title: "Animations", key: "animations_enabled", defaultValue: true },
  { value: "timestamps", title: "Timestamps", key: "timestamps", defaultValue: "hide" },
  { value: "thinking", title: "Thinking", key: "thinking_visibility", defaultValue: true },
  { value: "tool_details", title: "Tool Details", key: "tool_details_visibility", defaultValue: true },
  { value: "scrollbar", title: "Scrollbar", key: "scrollbar_visible", defaultValue: true },
]

export function DialogSettingsUI() {
  const kv = useKV()
  const dialog = useDialog()

  const getValue = (option: (typeof UI_OPTIONS)[number]) => {
    if (option.defaultValue === "hide" || option.defaultValue === "show") {
      return kv.get(option.key, option.defaultValue)
    }
    return kv.get(option.key, option.defaultValue as boolean)
  }

  const options = createMemo((): DialogSelectOption<UIOption>[] =>
    UI_OPTIONS.map((opt) => {
      const value = getValue(opt)
      const status = typeof value === "boolean" ? (value ? "ON" : "OFF") : value
      return {
        title: opt.title,
        value: opt.value,
        description: `${status}`,
      }
    }),
  )

  return (
    <DialogSelect
      title="UI Settings"
      options={options()}
      onSelect={(option) => {
        const opt = UI_OPTIONS.find((o) => o.value === option.value)
        if (!opt) return

        if (opt.defaultValue === "hide" || opt.defaultValue === "show") {
          const current = kv.get(opt.key, opt.defaultValue)
          const next = current === "show" ? "hide" : "show"
          kv.set(opt.key, next)
        } else {
          kv.set(opt.key, !kv.get(opt.key, opt.defaultValue as boolean))
        }
        dialog.clear()
      }}
    />
  )
}
