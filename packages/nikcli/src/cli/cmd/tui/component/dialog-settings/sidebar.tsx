import { createMemo } from "solid-js"
import { useKV } from "../../context/kv"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

type SidebarVisibility = "auto" | "show" | "hide"

const VISIBILITY_OPTIONS: { value: SidebarVisibility; title: string; description: string }[] = [
  { value: "auto", title: "Auto", description: "Show when space available" },
  { value: "show", title: "Show", description: "Always show sidebar" },
  { value: "hide", title: "Hide", description: "Always hide sidebar" },
]

export function DialogSettingsSidebar() {
  const kv = useKV()
  const dialog = useDialog()

  const visibility = createMemo(() => kv.get("sidebar", "auto") as SidebarVisibility)

  const options = createMemo((): DialogSelectOption<SidebarVisibility>[] =>
    VISIBILITY_OPTIONS.map((opt) => ({
      ...opt,
      title: opt.title,
      value: opt.value,
    })),
  )

  return (
    <DialogSelect
      title="Sidebar Visibility"
      options={options()}
      current={visibility()}
      onSelect={(option) => {
        kv.set("sidebar", option.value)
        dialog.clear()
      }}
    />
  )
}
