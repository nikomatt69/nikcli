import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogSettingsSpinner } from "./spinner"
import { DialogSettingsPrompt } from "./prompt"
import { DialogSettingsSidebar } from "./sidebar"
import { DialogSettingsUI } from "./ui"
import { DialogSettingsBrain } from "./brain"

export type SettingsCategory = "spinner" | "prompt" | "sidebar" | "ui" | "brain"

export function DialogSettings() {
  const dialog = useDialog()

  const categories = createMemo((): DialogSelectOption<SettingsCategory>[] => [
    {
      title: "Spinner",
      value: "spinner",
      description: "Loading animation style",
      category: "Appearance",
    },
    {
      title: "Prompt",
      value: "prompt",
      description: "Prompt area customization",
      category: "Appearance",
    },
    {
      title: "Sidebar",
      value: "sidebar",
      description: "Sidebar visibility and sections",
      category: "Layout",
    },
    {
      title: "UI",
      value: "ui",
      description: "General interface settings",
      category: "General",
    },
    {
      title: "Brain",
      value: "brain",
      description: "Memory consolidation settings",
      category: "General",
    },
  ])

  const handleSelect = (option: DialogSelectOption<SettingsCategory>) => {
    switch (option.value) {
      case "spinner":
        dialog.replace(() => <DialogSettingsSpinner />)
        break
      case "prompt":
        dialog.replace(() => <DialogSettingsPrompt />)
        break
      case "sidebar":
        dialog.replace(() => <DialogSettingsSidebar />)
        break
      case "ui":
        dialog.replace(() => <DialogSettingsUI />)
        break
      case "brain":
        dialog.replace(() => <DialogSettingsBrain />)
        break
    }
  }

  return <DialogSelect title="Settings" options={categories()} onSelect={handleSelect} />
}
