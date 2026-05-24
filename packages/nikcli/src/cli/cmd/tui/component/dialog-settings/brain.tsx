import { createSignal, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useToast } from "../../ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { Config } from "@/config/config"
import { useSync } from "../../context/sync"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"

type BrainOption = "enabled" | "minHours" | "minSessions" | "memoryEnabled"

function configUpdate(config: Config.Info) {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const service = yield* Config.Service
        yield* service.update(config)
      }),
    ),
  )
}

export function DialogSettingsBrain() {
  const toast = useToast()
  const dialog = useDialog()
  const sync = useSync()
  const instanceDirectory = () => sync.data.path.directory || process.cwd()

  const [brainEnabled, setBrainEnabled] = createSignal(true)
  const [memoryEnabled, setMemoryEnabled] = createSignal(true)
  const [minHours, setMinHours] = createSignal(24)
  const [minSessions, setMinSessions] = createSignal(5)

  onMount(async () => {
    try {
      const { getBrainConfig } = await import("@/brain")
      const config = await withInstanceAsync({ directory: instanceDirectory() }, () => getBrainConfig())
      setBrainEnabled(config.enabled)
      setMemoryEnabled(config.memoryEnabled)
      setMinHours(config.minHours)
      setMinSessions(config.minSessions)
    } catch {
      // use defaults
    }
  })

  const options = (): DialogSelectOption<BrainOption>[] => [
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

  const persist = async (
    patch: {
      brain?: boolean
      brainMinHours?: number
      brainMinSessions?: number
      memory?: boolean
    },
    success: string,
    rollback: () => void,
  ) => {
    try {
      await withInstanceAsync({ directory: instanceDirectory() }, () => configUpdate({ experimental: patch as any }))
      toast.show({ message: success, variant: "success" })
      dialog.clear()
    } catch (error) {
      rollback()
      toast.show({
        message: error instanceof Error ? error.message : "Failed to update Brain settings",
        variant: "error",
      })
    }
  }

  const cycleValue = async (option: BrainOption) => {
    switch (option) {
      case "enabled": {
        const previous = brainEnabled()
        const next = !previous
        setBrainEnabled(next)
        await persist({ brain: next }, `Brain ${next ? "enabled" : "disabled"}`, () => setBrainEnabled(previous))
        break
      }
      case "memoryEnabled": {
        const previous = memoryEnabled()
        const next = !previous
        setMemoryEnabled(next)
        await persist({ memory: next }, `Memory consolidation ${next ? "enabled" : "disabled"}`, () =>
          setMemoryEnabled(previous),
        )
        break
      }
      case "minHours": {
        const previous = minHours()
        const next = previous >= 72 ? 1 : previous + 1
        setMinHours(next)
        await persist({ brainMinHours: next }, `Brain minimum hours set to ${next}`, () => setMinHours(previous))
        break
      }
      case "minSessions": {
        const previous = minSessions()
        const next = previous >= 20 ? 1 : previous + 1
        setMinSessions(next)
        await persist({ brainMinSessions: next }, `Brain minimum sessions set to ${next}`, () =>
          setMinSessions(previous),
        )
        break
      }
    }
  }

  return (
    <DialogSelect title="Brain Settings" options={options()} onSelect={(option) => void cycleValue(option.value)} />
  )
}
