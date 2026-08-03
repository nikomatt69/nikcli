import { createMemo } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"

/**
 * Browser-control info dialog. The `browser_control` tool drives a real,
 * local, headless Chromium page through `@nikcli-ai/browser-control`'s
 * background daemon — there is no API key or model to configure, so this is a
 * short explainer rather than a setup flow.
 */
export function DialogBrowserControl() {
  const dialog = useDialog()

  const options = createMemo(() => [
    {
      title: "Local, no setup needed",
      value: "info.local",
      description:
        "The browser_control tool drives a real headless Chromium page — click, fill, wait, read state back.",
      category: "Browser Control",
    },
    {
      title: "One session per conversation",
      value: "info.session",
      description: "Sessions run in a background daemon; the agent doesn't need to name one unless it wants several.",
      category: "Browser Control",
    },
    {
      title: "Sessions persist until stopped",
      value: "info.lifecycle",
      description: "A stopped session stays queryable until removed, or the daemon reclaims it after 10 idle minutes.",
      category: "Browser Control",
    },
    {
      title: "Close",
      value: "close",
      category: "Browser Control",
      onSelect() {
        dialog.clear()
      },
    },
  ])

  return <DialogSelect title="Browser Control" options={options()} />
}
