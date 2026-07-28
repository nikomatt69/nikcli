import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import type { CommandOption } from "../dialog-command"
import { DialogSettingsSpinner } from "./spinner"
import { DialogSettingsPrompt } from "./prompt"
import { DialogSettingsSidebar } from "./sidebar"
import { DialogSettingsUI } from "./ui"
import { DialogSettingsBrain } from "./brain"

export type SettingsCategory = "spinner" | "prompt" | "sidebar" | "ui" | "brain"

type SettingsSearchEntry = {
  title: string
  keywords?: readonly string[]
}

type SettingsCategoryInfo = {
  title: string
  value: SettingsCategory
  description: string
  group: string
  keywords: readonly string[]
  settings: readonly SettingsSearchEntry[]
}

export const SETTINGS_CATEGORIES: readonly SettingsCategoryInfo[] = [
  {
    title: "Spinner",
    value: "spinner",
    description: "Loading animation style",
    group: "Appearance",
    keywords: ["loading", "animation", "indicator"],
    settings: [
      {
        title: "Spinner Visibility",
        keywords: ["enable", "disable", "on", "off"],
      },
      {
        title: "Spinner Style",
        keywords: ["knight rider", "braille", "dots", "line", "pulse"],
      },
    ],
  },
  {
    title: "Prompt",
    value: "prompt",
    description: "Prompt area customization",
    group: "Appearance",
    keywords: ["input", "composer"],
    settings: [
      { title: "Show Agent", keywords: ["agent name"] },
      { title: "Show Model", keywords: ["model info"] },
      { title: "Show Shortcuts", keywords: ["keyboard", "keybind", "hints"] },
      { title: "Show Sponsored", keywords: ["sponsor", "tips"] },
    ],
  },
  {
    title: "Sidebar",
    value: "sidebar",
    description: "Sidebar visibility and sections",
    group: "Layout",
    keywords: ["side panel", "navigation"],
    settings: [{ title: "Sidebar Visibility", keywords: ["auto", "show", "hide"] }],
  },
  {
    title: "UI",
    value: "ui",
    description: "General interface settings",
    group: "General",
    keywords: ["interface", "display"],
    settings: [
      { title: "Animations", keywords: ["motion", "effects"] },
      { title: "Timestamps", keywords: ["time", "messages"] },
      { title: "Thinking", keywords: ["reasoning", "chain of thought"] },
      { title: "Tool Details", keywords: ["tool output", "calls"] },
      { title: "Scrollbar", keywords: ["scroll bar"] },
    ],
  },
  {
    title: "Brain",
    value: "brain",
    description: "Memory consolidation settings",
    group: "General",
    keywords: ["memory", "consolidation"],
    settings: [
      { title: "Enable Brain", keywords: ["disable brain"] },
      { title: "Memory Consolidation", keywords: ["memory enabled"] },
      { title: "Min Hours", keywords: ["minimum hours", "interval"] },
      { title: "Min Sessions", keywords: ["minimum sessions"] },
      { title: "Brain Model", keywords: ["memory model", "provider"] },
    ],
  },
]

export function openSettingsCategory(dialog: DialogContext, category: SettingsCategory) {
  const content = () => {
    switch (category) {
      case "spinner":
        return <DialogSettingsSpinner />
      case "prompt":
        return <DialogSettingsPrompt />
      case "sidebar":
        return <DialogSettingsSidebar />
      case "ui":
        return <DialogSettingsUI />
      case "brain":
        return <DialogSettingsBrain />
    }
  }
  dialog.replace(content)
}

export function settingsCommandOptions(): CommandOption[] {
  return SETTINGS_CATEGORIES.flatMap((category) => {
    const open = (dialog: DialogContext) => openSettingsCategory(dialog, category.value)
    const context = [category.title, category.description, ...category.keywords]
    return [
      {
        title: `${category.title} Settings`,
        value: `settings.category.${category.value}`,
        description: category.description,
        category: "Settings",
        searchText: context.join(" "),
        onSelect: open,
      },
      ...category.settings.map((setting, index) => ({
        title: setting.title,
        value: `settings.${category.value}.${index}`,
        description: category.title,
        category: "Settings",
        searchText: [...context, ...(setting.keywords ?? [])].join(" "),
        onSelect: open,
      })),
    ]
  })
}

export function DialogSettings() {
  const dialog = useDialog()

  const categories = createMemo((): DialogSelectOption<SettingsCategory>[] =>
    SETTINGS_CATEGORIES.map((category) => ({
      title: category.title,
      value: category.value,
      description: category.description,
      category: category.group,
      searchText: category.keywords.join(" "),
    })),
  )

  const handleSelect = (option: DialogSelectOption<SettingsCategory>) => {
    openSettingsCategory(dialog, option.value)
  }

  return <DialogSelect title="Settings" options={categories()} onSelect={handleSelect} />
}
