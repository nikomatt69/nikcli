import { Keybind } from "@/util/keybind"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createMemo, createSignal } from "solid-js"
import { FUSION_BUILTIN_VARIANTS, FUSION_MODEL_ID, fusionPreset } from "@/provider/transform"

// OpenRouter Fusion presets are surfaced as model variants on `openrouter/fusion`
// (built-ins live in provider/transform.ts; user customs live in global config
// under provider.openrouter.models["openrouter/fusion"].variants). This plugin
// is a manager for those presets: create/edit/toggle, plus a master on/off that
// follows the plugin's enabled state in the Plugins list.
const id = "internal:fusion"
const OPENROUTER = "openrouter"
const BUILTIN_NAMES = Object.keys(FUSION_BUILTIN_VARIANTS)

const toggleKey = Keybind.parse("space").at(0)
const createKey = Keybind.parse("shift+i").at(0)
const removeKey = Keybind.parse("shift+d").at(0)

// Plugin-KV keys: removed custom names (config merge cannot delete keys), and
// the snapshot of presets that were enabled before the feature was turned off.
const KV_REMOVED = "fusion.removed"
const KV_SNAPSHOT = "fusion.snapshot"

type PresetRow = {
  name: string
  builtin: boolean
  enabled: boolean
  models: string[]
}

function kvList(api: TuiPluginApi, key: string): string[] {
  const value = api.kv.get<string[]>(key, [])
  return Array.isArray(value) ? value : []
}

function configVariants(api: TuiPluginApi): Record<string, any> {
  const provider = (api.state.config as any)?.provider?.[OPENROUTER]
  return provider?.models?.[FUSION_MODEL_ID]?.variants ?? {}
}

function presetModels(value: any): string[] {
  const plugin = value?.plugins?.find?.((p: any) => p?.id === "fusion") ?? value?.plugins?.[0]
  return Array.isArray(plugin?.analysis_models) ? plugin.analysis_models : []
}

// Merge built-ins + config customs, applying optimistic in-session overrides so
// the UI reflects writes immediately (synced config state can lag a tick).
function listPresets(api: TuiPluginApi, overrides: Record<string, Partial<PresetRow> | "removed">): PresetRow[] {
  const cfg = configVariants(api)
  const removed = new Set(kvList(api, KV_REMOVED))
  const names = new Set<string>([...BUILTIN_NAMES, ...Object.keys(cfg)])
  const rows: PresetRow[] = []
  for (const name of names) {
    const ov = overrides[name]
    if (ov === "removed" || removed.has(name)) continue
    const builtin = BUILTIN_NAMES.includes(name)
    const cfgEntry = cfg[name]
    const base = builtin ? FUSION_BUILTIN_VARIANTS[name] : cfgEntry
    const enabled = cfgEntry?.disabled !== true
    rows.push({
      name,
      builtin,
      enabled: ov?.enabled ?? enabled,
      models: ov?.models ?? presetModels(base),
    })
  }
  return rows.sort((a, b) => (a.builtin === b.builtin ? a.name.localeCompare(b.name) : a.builtin ? -1 : 1))
}

async function writeVariants(api: TuiPluginApi, variants: Record<string, any>): Promise<boolean> {
  const { error } = await api.client.config.update({
    config: {
      provider: {
        [OPENROUTER]: { models: { [FUSION_MODEL_ID]: { variants } } },
      },
    },
  } as any)
  if (error) {
    api.ui.toast({
      variant: "error",
      message: "Failed to update fusion presets",
    })
    return false
  }
  return true
}

function View(props: { api: TuiPluginApi }) {
  const api = props.api
  const [refresh, setRefresh] = createSignal(0)
  const [overrides, setOverrides] = createSignal<Record<string, Partial<PresetRow> | "removed">>({})
  const [busy, setBusy] = createSignal(false)

  const rows = createMemo((): DialogSelectOption<string>[] => {
    refresh()
    return listPresets(api, overrides()).map((p) => ({
      title: p.name,
      value: p.name,
      category: p.builtin ? "Built-in" : "Custom",
      description: p.models.join(", ") || "no analysis models",
      footer: (
        <span
          style={{
            fg: p.enabled ? api.theme.current.success : api.theme.current.textMuted,
          }}
        >
          {p.enabled ? "enabled" : "disabled"}
        </span>
      ),
    }))
  })

  function setOverride(name: string, value: Partial<PresetRow> | "removed") {
    setOverrides((prev) => ({ ...prev, [name]: value }))
    setRefresh((r) => r + 1)
  }

  async function toggle(name: string) {
    if (busy()) return
    const current = listPresets(api, overrides()).find((p) => p.name === name)
    if (!current) return
    const next = !current.enabled
    setBusy(true)
    setOverride(name, { enabled: next })
    const ok = await writeVariants(api, {
      [name]: { disabled: !next },
    }).finally(() => setBusy(false))
    if (ok)
      api.ui.toast({
        variant: "success",
        message: `${name} ${next ? "enabled" : "disabled"}`,
      })
  }

  function remove(name: string) {
    if (busy()) return
    if (BUILTIN_NAMES.includes(name)) {
      api.ui.toast({
        variant: "info",
        message: "Built-in presets can be disabled but not removed",
      })
      return
    }
    setBusy(true)
    api.kv.set(KV_REMOVED, [...new Set([...kvList(api, KV_REMOVED), name])])
    setOverride(name, "removed")
    writeVariants(api, { [name]: { disabled: true } })
      .then((ok) => {
        if (ok) api.ui.toast({ variant: "success", message: `Removed ${name}` })
      })
      .finally(() => setBusy(false))
  }

  // Create flow: name -> analysis models -> primary picker.
  function create() {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="New fusion preset"
        placeholder="preset name"
        onCancel={() => show(api)}
        onConfirm={(rawName) => {
          const name = rawName.trim()
          if (!name) {
            api.ui.toast({
              variant: "error",
              message: "Preset name is required",
            })
            return
          }
          if (BUILTIN_NAMES.includes(name)) {
            api.ui.toast({
              variant: "error",
              message: `"${name}" is a built-in preset name`,
            })
            return
          }
          promptModels(name)
        }}
      />
    ))
  }

  function promptModels(name: string) {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title={`Models for "${name}"`}
        placeholder="~anthropic/claude-opus-latest, ~openai/gpt-latest, ..."
        description={() => <text fg={api.theme.current.textMuted}>comma or space separated OpenRouter slugs</text>}
        onCancel={() => show(api)}
        onConfirm={(rawModels) => {
          const models = rawModels
            .split(/[\s,]+/)
            .map((m) => m.trim())
            .filter(Boolean)
          if (!models.length) {
            api.ui.toast({
              variant: "error",
              message: "At least one analysis model is required",
            })
            return
          }
          pickPrimary(name, models)
        }}
      />
    ))
  }

  function pickPrimary(name: string, models: string[]) {
    api.ui.dialog.replace(() => (
      <DialogSelect
        title={`Primary model for "${name}"`}
        options={models.map((m) => ({
          title: m,
          value: m,
          description: "primary (analysis) model",
        }))}
        current={models[0]}
        onSelect={(item) => void finishCreate(name, models, item.value)}
      />
    ))
  }

  async function finishCreate(name: string, models: string[], primary: string) {
    setBusy(true)
    api.kv.set(
      KV_REMOVED,
      kvList(api, KV_REMOVED).filter((n) => n !== name),
    )
    const value = { ...fusionPreset(models, primary), disabled: false }
    const ok = await writeVariants(api, { [name]: value }).finally(() => setBusy(false))
    if (ok) {
      setOverride(name, { name, builtin: false, enabled: true, models })
      api.ui.toast({ variant: "success", message: `Created ${name}` })
    }
    show(api)
  }

  return (
    <DialogSelect
      title="Fusion presets"
      options={rows()}
      keybind={[
        {
          title: "toggle",
          keybind: toggleKey,
          disabled: busy(),
          onTrigger: (item) => void toggle(item.value),
        },
        {
          title: "new",
          keybind: createKey,
          disabled: busy(),
          onTrigger: () => create(),
        },
        {
          title: "remove",
          keybind: removeKey,
          disabled: busy(),
          onTrigger: (item) => remove(item.value),
        },
      ]}
      onSelect={(item) => void toggle(item.value)}
    />
  )
}

function show(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <View api={api} />)
}

// Master on/off follows the plugin's enabled state in the Plugins list: turning
// the plugin off snapshots the currently-enabled presets and disables them all
// (hiding the variants from the model picker); turning it back on restores them.
async function applyMasterOff(api: TuiPluginApi) {
  const enabled = listPresets(api, {})
    .filter((p) => p.enabled)
    .map((p) => p.name)
  if (!enabled.length) return
  api.kv.set(KV_SNAPSHOT, enabled)
  await writeVariants(api, Object.fromEntries(enabled.map((n) => [n, { disabled: true }])))
}

async function applyMasterOn(api: TuiPluginApi) {
  const snapshot = kvList(api, KV_SNAPSHOT)
  if (!snapshot.length) return
  api.kv.set(KV_SNAPSHOT, [])
  await writeVariants(api, Object.fromEntries(snapshot.map((n) => [n, { disabled: false }])))
}

// onDispose fires both on user-initiated deactivation AND on TUI shutdown. The
// runtime persists the plugin's enabled flag (kv "plugin_enabled") before
// disposing, so a `false` there means the user toggled the plugin off — only
// then should the master-off run (otherwise quitting the app would disable the
// presets every time).
function userDisabledPlugin(api: TuiPluginApi): boolean {
  const map = api.kv.get<Record<string, boolean>>("plugin_enabled", {})
  return map?.[id] === false
}

const tui: TuiPlugin = async (api) => {
  void applyMasterOn(api)
  api.lifecycle.onDispose(() => {
    if (userDisabledPlugin(api)) return applyMasterOff(api)
  })
  api.keymap.registerLayer({
    commands: [
      {
        name: "fusion.presets",
        title: "Fusion presets",
        namespace: "System",
        run() {
          show(api)
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
