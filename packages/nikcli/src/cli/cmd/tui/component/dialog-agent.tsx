import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      const footer = [item.native ? "native" : undefined, item.advisor ? "advisor" : undefined]
        .filter(Boolean)
        .join(" · ")
      return {
        value: item.name,
        title: item.name,
        description: item.description,
        footer: footer || undefined,
        gutter: <text fg={local.agent.color(item.name)}>@{item.name.slice(0, 8)}</text>,
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
