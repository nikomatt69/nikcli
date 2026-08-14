import { type SlotMode, type TuiPluginApi, type TuiSlotContext, type TuiSlotMap } from "@nikcli-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { createSignal } from "solid-js"
import { isRecord } from "@nikcli-ai/util/record"
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
// The registry outlives individual setupSlots() calls, so the error reporter
// reads the current host api instead of capturing the one it was built with.
let currentApi: HostPluginApi | undefined
const reportedErrors = new Set<string>()

// A throwing slot render is already contained per plugin by the slot library's
// error boundary: the rest of the TUI keeps rendering. Surface it as one toast
// so a silently blank slot is not the only signal. Repeats of the same failure
// stay quiet — a broken render re-throws on every frame.
function reportSlotError(event: {
  pluginId: string
  slot?: string | number | symbol
  phase: string
  source?: string
  error: Error
}) {
  console.error("[tui.slot] plugin error", {
    plugin: event.pluginId,
    slot: event.slot,
    phase: event.phase,
    source: event.source,
    message: event.error.message,
  })

  const key = `${event.pluginId}:${String(event.slot ?? "")}:${event.error.message}`
  if (reportedErrors.has(key)) return
  reportedErrors.add(key)
  const where = event.slot === undefined ? "a slot" : `slot ${String(event.slot)}`
  currentApi?.ui.toast({
    variant: "error",
    title: "Plugin",
    message: `${event.pluginId} crashed in ${where}: ${event.error.message}`,
  })
}

/** Lets a reloaded plugin report the same failure again. */
export function clearSlotErrors(pluginId: string) {
  for (const key of reportedErrors) {
    if (key.startsWith(`${pluginId}:`)) reportedErrors.delete(key)
  }
}

export function setupSlots(api: HostPluginApi): HostSlots {
  currentApi = api
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
      onPluginError: reportSlotError,
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
