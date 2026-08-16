import { createMemo } from "solid-js"
import { useKV } from "../../context/kv"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export type SpinnerStyle =
  | "knight_rider_blocks"
  | "knight_rider_diamonds"
  | "braille"
  | "dots"
  | "line"
  | "bouncing"
  | "pulse"
  | "none"

const SPINNER_OPTIONS: { value: SpinnerStyle; title: string; description: string }[] = [
  { value: "knight_rider_blocks", title: "Knight Rider (Blocks)", description: "Animated scanner with blocks" },
  { value: "knight_rider_diamonds", title: "Knight Rider (Diamonds)", description: "Animated scanner with diamonds" },
  { value: "braille", title: "Braille", description: "Braille character animation" },
  { value: "dots", title: "Dots", description: "Simple dot animation" },
  { value: "line", title: "Line", description: "Rotating line" },
  { value: "bouncing", title: "Bouncing", description: "Bouncing characters" },
  { value: "pulse", title: "Pulse", description: "Pulsing indicator" },
  { value: "none", title: "None", description: "No spinner" },
]

export function DialogSettingsSpinner() {
  const kv = useKV()
  const dialog = useDialog()

  const enabled = createMemo(() => kv.get("settings.spinner.enabled", true))
  const currentStyle = createMemo(() => kv.get("settings.spinner.style", "knight_rider_blocks") as SpinnerStyle)

  const options = createMemo((): DialogSelectOption<SpinnerStyle | "enabled">[] => [
    {
      title: enabled() ? "Spinner: ON" : "Spinner: OFF",
      value: "enabled" as const,
      description: "Toggle spinner visibility",
    },
    ...SPINNER_OPTIONS.map((opt) => ({
      ...opt,
      title: opt.title,
      value: opt.value as SpinnerStyle,
    })),
  ])

  return (
    <DialogSelect
      title="Spinner Style"
      options={options()}
      current={currentStyle()}
      onSelect={(option) => {
        if (option.value === "enabled") {
          kv.set("settings.spinner.enabled", !kv.get("settings.spinner.enabled", true))
        } else {
          kv.set("settings.spinner.style", option.value)
        }
        dialog.clear()
      }}
    />
  )
}
