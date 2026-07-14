import { type SlotMode, type TuiPluginApi, type TuiSlotContext, type TuiSlotMap } from "@nikcli-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { createSignal } from "solid-js"
import { isRecord } from "@/util/record"
import type { SlotRegistry } from "@opentui/core"

type SlotProps<K extends keyof TuiSlotMap> = {
  name: K
  mode?: SlotMode
  children?: JSX.Element
} & TuiSlotMap[K]

type Slot = <K extends keyof TuiSlotMap>(props: SlotProps<K>) => JSX.Element | null
export type HostSlotPlugin = SolidPlugin<TuiSlotMap, TuiSlotContext>

export type HostPluginApi = TuiPluginApi
export type HostSlots = {
  register: (plugin: HostSlotPlugin) => () => void
}

function empty<K extends keyof TuiSlotMap>(props: SlotProps<K>) {
  return props.children ?? null
}

const [current, setCurrent] = createSignal<Slot>(empty)

export const Slot: Slot = (props) => current()(props)

function isHostSlotPlugin(value: unknown): value is HostSlotPlugin {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (!isRecord(value.slots)) return false
  return true
}

// Cache the registry to avoid creating multiple registries for the same renderer
// opentui/core throws if createSolidSlotRegistry is called with a different context
// for the same renderer key
let cachedRegistry: SlotRegistry<JSX.Element, TuiSlotMap, TuiSlotContext> | undefined
let cachedRenderer: unknown = undefined

export function setupSlots(api: HostPluginApi): HostSlots {
  // Reuse existing registry if renderer is the same
  if (cachedRegistry && cachedRenderer === api.renderer) {
    const slot = createSlot<TuiSlotMap, TuiSlotContext>(cachedRegistry)
    const next: Slot = (props) => slot(props)
    setCurrent(() => next)
    return {
      register(plugin) {
        if (!isHostSlotPlugin(plugin)) return () => {}
        return cachedRegistry!.register(plugin)
      },
    }
  }

  const reg = createSolidSlotRegistry<TuiSlotMap, TuiSlotContext>(
    api.renderer as any,
    {
      theme: api.theme,
    },
    {
      onPluginError(event) {
        console.error("[tui.slot] plugin error", {
          plugin: event.pluginId,
          slot: event.slot,
          phase: event.phase,
          source: event.source,
          message: event.error.message,
        })
      },
    },
  )

  cachedRegistry = reg
  cachedRenderer = api.renderer

  const slot = createSlot<TuiSlotMap, TuiSlotContext>(reg)
  const next: Slot = (props) => slot(props)
  setCurrent(() => next)
  return {
    register(plugin) {
      if (!isHostSlotPlugin(plugin)) return () => {}
      return reg.register(plugin)
    },
  }
}
