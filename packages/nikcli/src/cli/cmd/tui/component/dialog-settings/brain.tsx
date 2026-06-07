import { createMemo, createSignal, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useToast } from "../../ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { Config } from "@/config/config"
import { useSync } from "../../context/sync"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"
import { DialogModel } from "../dialog-model"

type BrainOption = "enabled" | "minHours" | "minSessions" | "memoryEnabled" | "model" | "resetModel"

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
  const [brainModel, setBrainModel] = createSignal<{ providerID: string; modelID: string } | undefined>(undefined)

  onMount(async () => {
    try {
      const { getBrainConfig } = await import("@/brain")
      const config = await withInstanceAsync({ directory: instanceDirectory() }, () => getBrainConfig())
      setBrainEnabled(config.enabled)
      setMemoryEnabled(config.memoryEnabled)
      setMinHours(config.minHours)
      setMinSessions(config.minSessions)
      setBrainModel(config.model)
    } catch {
      // use defaults
    }
  })

  const modelDescription = createMemo(() => {
    const m = brainModel()
    if (!m) return "Default"
    const provider = sync.data.provider.find((x) => x.id === m.providerID)
    const info = provider?.models[m.modelID]
    return `${info?.name ?? m.modelID} (${provider?.name ?? m.providerID})`
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
    {
      title: "Model",
      value: "model",
      description: modelDescription(),
    },
  ]

  if (brainModel()) {
    options().push({
      title: "Reset Model to Default",
      value: "resetModel",
      description: "Use the default model for Brain",
    })
  }

  const persist = async (
    patch: {
      brain?: boolean
      brainMinHours?: number
      brainMinSessions?: number
      brainModel?: string
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

  const setBrainModelPersisted = async (model: { providerID: string; modelID: string } | undefined) => {
    const previous = brainModel()
    setBrainModel(model)
    const modelString = model ? `${model.providerID}/${model.modelID}` : undefined
    await persist(
      { brainModel: modelString },
      model ? `Brain model set to ${model.providerID}/${model.modelID}` : "Brain model reset to default",
      () => setBrainModel(previous),
    )
  }

  const openModelPicker = () => {
    dialog.replace(() => (
      <DialogModel
        onSelect={(model) => {
          void setBrainModelPersisted(model)
        }}
      />
    ))
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
      case "model": {
        openModelPicker()
        break
      }
      case "resetModel": {
        await setBrainModelPersisted(undefined)
        break
      }
    }
  }

  return (
    <DialogSelect title="Brain Settings" options={options()} onSelect={(option) => void cycleValue(option.value)} />
  )
}
