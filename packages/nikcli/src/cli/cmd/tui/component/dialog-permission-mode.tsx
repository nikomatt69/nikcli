import { createMemo, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import {
  PERMISSION_ITEMS,
  PERMISSION_PRESETS,
  detectPermissionMode,
  getPermissionActionFor,
  permissionModeDescription,
  permissionModeTitle,
  permissionPresetPatch,
  toPermissionMap,
  type PermissionAction,
  type PermissionMap,
  type PermissionMode,
  type PermissionPreset,
} from "@tui/util/permission-presets"

type RowValue = { kind: "preset"; preset: PermissionPreset } | { kind: "tool"; id: string } | { kind: "scope" }

const ACTION_CYCLE: PermissionAction[] = ["allow", "ask", "deny"]

function nextAction(current: PermissionAction): PermissionAction {
  const index = ACTION_CYCLE.indexOf(current)
  return ACTION_CYCLE[(index + 1) % ACTION_CYCLE.length]!
}

function actionLabel(action: PermissionAction) {
  switch (action) {
    case "allow":
      return "Allow"
    case "ask":
      return "Ask"
    case "deny":
      return "Deny"
  }
}

/** Distinct color per approval mode for prompt footer / badges. */
export function permissionModeColor(mode: PermissionMode, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (mode) {
    case "require_approval":
      return theme.status.warning.fg
    case "approve_for_me":
      return theme.accent.fg
    case "full_access":
      return theme.status.success.fg
    case "custom":
      return theme.accent.secondary
  }
}

function ActionBadge(props: { action: PermissionAction }) {
  const { theme } = useTheme()
  const color = () => {
    if (props.action === "allow") return theme.status.success.fg
    if (props.action === "deny") return theme.status.error.fg
    return theme.status.warning.fg
  }
  return (
    <span style={{ fg: color(), attributes: TextAttributes.BOLD }}>
      {props.action === "allow" ? "✓" : props.action === "deny" ? "✕" : "?"} {actionLabel(props.action)}
    </span>
  )
}

function PresetBadge(props: { active: boolean; mode: PermissionMode }) {
  const { theme } = useTheme()
  if (!props.active) return <span style={{ fg: theme.foreground.muted }}>○</span>
  return <span style={{ fg: permissionModeColor(props.mode, theme), attributes: TextAttributes.BOLD }}>✓ active</span>
}

export function DialogPermissionMode() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [saving, setSaving] = createSignal(false)
  const [selected, setSelected] = createSignal<RowValue | undefined>()

  const agentName = createMemo(() => local.agent.current().name)

  const permissionMap = createMemo((): PermissionMap => {
    const config = sync.data.config as Record<string, any>
    const agentPerm = config?.agent?.[agentName()]?.permission
    if (agentPerm !== undefined && agentPerm !== null) return toPermissionMap(agentPerm)
    return toPermissionMap(config?.permission)
  })

  const mode = createMemo(() => detectPermissionMode(permissionMap()))

  const options = createMemo((): DialogSelectOption<RowValue>[] => {
    const currentMode = mode()
    const map = permissionMap()
    const name = agentName()

    const scopeRow: DialogSelectOption<RowValue> = {
      value: { kind: "scope" },
      title: Locale.titlecase(name),
      description: `Primary agent permissions · ${permissionModeTitle(currentMode)}`,
      category: "Agent",
      footer: (
        <span style={{ fg: permissionModeColor(currentMode, theme), attributes: TextAttributes.BOLD }}>
          {permissionModeTitle(currentMode)}
        </span>
      ),
      disabled: true,
    }

    const presetRows: DialogSelectOption<RowValue>[] = PERMISSION_PRESETS.map((preset) => ({
      value: { kind: "preset", preset },
      title: permissionModeTitle(preset),
      description: permissionModeDescription(preset),
      category: "Presets",
      gutter: (
        <text fg={permissionModeColor(preset, theme)} attributes={TextAttributes.BOLD}>
          ●
        </text>
      ),
      footer: <PresetBadge active={currentMode === preset} mode={preset} />,
    }))

    const toolRows: DialogSelectOption<RowValue>[] = PERMISSION_ITEMS.map((item) => {
      const action = getPermissionActionFor(map, item.id)
      return {
        value: { kind: "tool", id: item.id },
        title: item.title,
        description: item.description,
        category: "Tools",
        footer: <ActionBadge action={action} />,
      }
    })

    return [scopeRow, ...presetRows, ...toolRows]
  })

  async function refresh() {
    const [cfg, agents] = await Promise.all([
      sdk.client.config.get({}, { throwOnError: true }),
      sdk.client.app.agents({}, { throwOnError: true }),
    ])
    sync.set("config", cfg.data as any)
    sync.set("agent", agents.data ?? [])
  }

  async function writeAgentPermission(patch: PermissionMap, successMessage: string) {
    if (saving()) return
    const name = agentName()
    setSaving(true)
    try {
      const { error } = await sdk.client.config.update({
        payload: {
          agent: {
            [name]: {
              permission: patch,
            },
          },
        } as any,
      })
      if (error) {
        toast.show({
          message: `Failed to update permissions: ${(error as any).message ?? error}`,
          variant: "error",
        })
        return
      }
      await refresh()
      toast.show({ message: successMessage, variant: "success" })
    } catch (error: any) {
      toast.show({
        message: `Failed to update permissions: ${error?.message ?? String(error)}`,
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  async function applyPreset(preset: PermissionPreset) {
    await writeAgentPermission(
      permissionPresetPatch(preset),
      `${Locale.titlecase(agentName())}: ${permissionModeTitle(preset)}`,
    )
  }

  async function cycleTool(id: string) {
    const current = getPermissionActionFor(permissionMap(), id)
    const next = nextAction(current)
    await writeAgentPermission({ [id]: next }, `${id} → ${actionLabel(next)}`)
  }

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: selected()?.kind === "tool" ? "cycle" : selected()?.kind === "preset" ? "apply" : "—",
      disabled: saving() || selected()?.kind === "scope",
      onTrigger: async (option: DialogSelectOption<RowValue>) => {
        if (saving()) return
        const value = option.value
        if (value.kind === "preset") {
          await applyPreset(value.preset)
          return
        }
        if (value.kind === "tool") {
          await cycleTool(value.id)
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title={`Permissions · ${Locale.titlecase(agentName())}`}
      current={
        mode() === "custom" ? undefined : ({ kind: "preset", preset: mode() as PermissionPreset } satisfies RowValue)
      }
      options={options()}
      keybind={keybinds()}
      onMove={(item) => setSelected(item.value)}
      onSelect={(option) => {
        if (saving()) return
        if (option.value.kind === "preset") void applyPreset(option.value.preset)
        if (option.value.kind === "tool") void cycleTool(option.value.id)
      }}
    />
  )
}

export function permissionModeShortLabel(mode: PermissionMode) {
  switch (mode) {
    case "require_approval":
      return "Ask"
    case "approve_for_me":
      return "Approve"
    case "full_access":
      return "Full"
    case "custom":
      return "Custom"
  }
}

export function currentAgentPermissionMode(config: Record<string, any> | undefined, agentName: string): PermissionMode {
  const agentPerm = config?.agent?.[agentName]?.permission
  if (agentPerm !== undefined && agentPerm !== null) return detectPermissionMode(agentPerm)
  return detectPermissionMode(config?.permission)
}
