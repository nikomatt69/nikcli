import { createSignal, onMount } from "solid-js"
import { useKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"

type DreamOption = "enabled" | "minHours" | "minSessions" | "memoryEnabled"

const DREAM_OPTIONS: { value: DreamOption; title: string; key: string }[] = [
  { value: "enabled", title: "Enable Brain", key: "dream_enabled" },
  { value: "minHours", title: "Min Hours", key: "dream_min_hours" },
  { value: "minSessions", title: "Min Sessions", key: "dream_min_sessions" },
  { value: "memoryEnabled", title: "Memory Consolidation", key: "dream_memory_enabled" },
]

export function DialogSettingsBrain() {
  const kv = useKV()
  const { theme } = useTheme()

  const [brainEnabled, setBrainEnabled] = createSignal(kv.get("brain_enabled", true))
  const [memoryEnabled, setMemoryEnabled] = createSignal(kv.get("brain_memory_enabled", true))
  const [minHours, setMinHours] = createSignal(kv.get("brain_min_hours", 24))
  const [minSessions, setMinSessions] = createSignal(kv.get("brain_min_sessions", 5))

  onMount(async () => {
    try {
      const { getBrainConfig } = await import("@/brain")
      const config = await getBrainConfig()
      setBrainEnabled(config.enabled)
      setMemoryEnabled(config.memoryEnabled)
      setMinHours(config.minHours)
      setMinSessions(config.minSessions)
    } catch {
      // use defaults
    }
  })

  const options = (): DialogSelectOption<DreamOption>[] => [
    {
      title: "Enable Brain",
      value: "enabled",
      description: brainEnabled() ? "ON" : "OFF",
    },
    {
      title: "Memory Consolidation",
      value: "memoryEnabled",
      description: memoryEnabled() ? "ON" : "OFF",
    },
    {
      title: "Min Hours",
      value: "minHours",
      description: `${minHours()}h`,
    },
    {
      title: "Min Sessions",
      value: "minSessions",
      description: `${minSessions()} sessions`,
    },
  ]

  const cycleValue = (option: DreamOption) => {
    switch (option) {
      case "enabled":
        setBrainEnabled((v) => {
          kv.set("brain_enabled", !v)
          return !v
        })
        break
      case "memoryEnabled":
        setMemoryEnabled((v) => {
          kv.set("brain_memory_enabled", !v)
          return !v
        })
        break
      case "minHours":
        setMinHours((v) => {
          const next = v >= 72 ? 1 : v + 1
          kv.set("brain_min_hours", next)
          return next
        })
        break
      case "minSessions":
        setMinSessions((v) => {
          const next = v >= 20 ? 1 : v + 1
          kv.set("brain_min_sessions", next)
          return next
        })
        break
    }
  }

  return <DialogSelect title="Brain Settings" options={options()} onSelect={(option) => cycleValue(option.value)} />
}
