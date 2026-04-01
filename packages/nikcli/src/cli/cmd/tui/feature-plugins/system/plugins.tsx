import { Keybind } from "@/util/keybind"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiPluginStatus } from "@nikcli-ai/plugin/tui"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { fileURLToPath } from "url"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Show, createEffect, createMemo, createSignal, For } from "solid-js"
import { Plugin } from "@/plugin"
import { getPluginErrorMessage, type PluginError } from "@/plugin/errors"
import { validatePluginManifest, type ManifestValidationResult } from "@/plugin/manifest"
import { Installation } from "@/installation"

const id = "internal:plugin-manager"
const key = Keybind.parse("space").at(0)
const add = Keybind.parse("shift+i").at(0)
const tab = Keybind.parse("tab").at(0)
const validateKey = Keybind.parse("v").at(0)
const hooksKey = Keybind.parse("h").at(0)
const errorsKey = Keybind.parse("e").at(0)

function state(api: TuiPluginApi, item: TuiPluginStatus & { hasError?: boolean; hookCount?: number }) {
  if (!item.enabled) {
    return <text fg={api.theme.current.textMuted}>disabled</text>
  }

  if (item.target === "server") {
    return <text fg={api.theme.current.textMuted}>server</text>
  }

  const parts: string[] = []
  if (item.hookCount !== undefined && item.hookCount > 0) {
    parts.push(`${item.hookCount} hook${item.hookCount > 1 ? "s" : ""}`)
  }
  parts.push(item.active ? "active" : "inactive")

  return (
    <text
      style={{
        fg: item.hasError ? api.theme.current.error : item.active ? api.theme.current.success : api.theme.current.error,
      }}
    >
      {item.hasError ? "! " : ""}
      {parts.join(" ")}
    </text>
  )
}

function source(spec: string) {
  if (!spec.startsWith("file://")) return
  return fileURLToPath(spec)
}

function meta(item: TuiPluginStatus, width: number) {
  if (item.source === "internal") {
    if (width >= 120) return "Built-in plugin"
    return "Built-in"
  }
  const next = source(item.spec)
  if (next) return next
  return item.spec
}

async function validatePlugin(spec: string): Promise<ManifestValidationResult> {
  const version = Installation.VERSION
  return validatePluginManifest(spec, version)
}

const recentErrors = new Map<string, { error: PluginError; timestamp: number }>()

function addRecentError(pluginId: string, error: PluginError) {
  recentErrors.set(pluginId, { error, timestamp: Date.now() })
  if (recentErrors.size > 50) {
    const oldest = [...recentErrors.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
    if (oldest) recentErrors.delete(oldest[0])
  }
}

function ViewErrors(props: { api: TuiPluginApi; pluginId: string; onClose: () => void }) {
  const errors = () => {
    const all = Plugin.getErrors()
    return all
      .map((e) => JSON.parse(e) as PluginError)
      .filter((e) => {
        if (e.code === "hook-execution-failed" && e.spec === props.pluginId) return true
        if ("spec" in e && e.spec === props.pluginId) return true
        return props.pluginId === "all"
      })
  }

  return (
    <props.api.ui.Dialog
      onClose={props.onClose}
      children={
        <box flexDirection="column" gap={1} padding={1}>
          <text fg={props.api.theme.current.text}>
            <span style={{ bold: true }}>{`Plugin Errors: ${props.pluginId}`}</span>
          </text>
          <Show
            when={errors().length > 0}
            fallback={<text fg={props.api.theme.current.textMuted}>No errors for this plugin</text>}
          >
            <For each={errors()}>
              {(error) => (
                <box flexDirection="column" gap={0} paddingY={0}>
                  <text fg={props.api.theme.current.error}>
                    <span style={{ fg: props.api.theme.current.textMuted }}>[{error.code}]</span>{" "}
                    {getPluginErrorMessage(error)}
                  </text>
                </box>
              )}
            </For>
          </Show>
          <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
            <text fg={props.api.theme.current.textMuted}>(esc) close</text>
          </box>
        </box>
      }
    />
  )
}

function ViewValidation(props: { api: TuiPluginApi; pluginId: string; onClose: () => void }) {
  const [loading, setLoading] = createSignal(true)
  const [result, setResult] = createSignal<ManifestValidationResult | null>(null)

  createEffect(async () => {
    setLoading(true)
    const item = props.api.plugins.list().find((p) => p.id === props.pluginId)
    if (item) {
      const res = await validatePlugin(item.spec)
      setResult(res)
    }
    setLoading(false)
  })

  return (
    <props.api.ui.Dialog
      onClose={props.onClose}
      children={
        <box flexDirection="column" gap={1} padding={1}>
          <text fg={props.api.theme.current.text}>
            <span style={{ bold: true }}>{`Validate: ${props.pluginId}`}</span>
          </text>
          <Show when={loading()}>
            <text fg={props.api.theme.current.textMuted}>Validating...</text>
          </Show>
          <Show when={!loading() && result()}>
            <Show
              when={result()?.valid}
              fallback={
                <box flexDirection="column" gap={0}>
                  <text fg={props.api.theme.current.error}>Validation Failed</text>
                  <For each={result()?.errors ?? []}>
                    {(err) => (
                      <text fg={props.api.theme.current.error}>
                        <span style={{ fg: props.api.theme.current.textMuted }}>{err.field}:</span> {err.message}
                      </text>
                    )}
                  </For>
                </box>
              }
            >
              <text fg={props.api.theme.current.success}>Manifest is valid</text>
            </Show>
            <Show when={(result()?.warnings ?? []).length > 0}>
              <box flexDirection="column" gap={0} marginTop={1}>
                <text fg={props.api.theme.current.warning}>Warnings:</text>
                <For each={result()?.warnings ?? []}>
                  {(warn) => (
                    <text fg={props.api.theme.current.warning}>
                      <span style={{ fg: props.api.theme.current.textMuted }}>-</span> {warn}
                    </text>
                  )}
                </For>
              </box>
            </Show>
          </Show>
          <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
            <text fg={props.api.theme.current.textMuted}>(esc) close</text>
          </box>
        </box>
      }
    />
  )
}

function ViewHooks(props: { api: TuiPluginApi; pluginId: string; onClose: () => void }) {
  return (
    <props.api.ui.Dialog
      onClose={props.onClose}
      children={
        <box flexDirection="column" gap={1} padding={1}>
          <text fg={props.api.theme.current.text}>
            <span style={{ bold: true }}>{`Hooks: ${props.pluginId}`}</span>
          </text>
          <text fg={props.api.theme.current.textMuted}>Hook matcher status not available from TUI</text>
          <text fg={props.api.theme.current.textMuted} marginTop={1}>
            Use server logs for hook execution details
          </text>
          <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
            <text fg={props.api.theme.current.textMuted}>(esc) close</text>
          </box>
        </box>
      }
    />
  )
}

function Install(props: { api: TuiPluginApi }) {
  const [global, setGlobal] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  useKeyboard((evt) => {
    if (evt.name !== "tab") return
    evt.preventDefault()
    evt.stopPropagation()
    if (busy()) return
    setGlobal((x) => !x)
  })

  return (
    <props.api.ui.DialogPrompt
      title="Install plugin"
      placeholder="npm package name"
      busy={busy()}
      busyText="Installing plugin..."
      description={() => (
        <box flexDirection="row" gap={1}>
          <text fg={props.api.theme.current.textMuted}>scope:</text>
          <text fg={busy() ? props.api.theme.current.textMuted : props.api.theme.current.text}>
            {global() ? "global" : "local"}
          </text>
          <Show when={!busy()}>
            <text fg={props.api.theme.current.textMuted}>({Keybind.toString(tab)} toggle)</text>
          </Show>
        </box>
      )}
      onConfirm={(raw) => {
        if (busy()) return
        const mod = raw.trim()
        if (!mod) {
          props.api.ui.toast({
            variant: "error",
            message: "Plugin package name is required",
          })
          return
        }

        setBusy(true)
        props.api.plugins
          .install(mod, { global: global() })
          .then((out) => {
            if (!out.ok) {
              props.api.ui.toast({
                variant: "error",
                message: out.message,
              })
              if (out.missing) {
                props.api.ui.toast({
                  variant: "info",
                  message: "Check npm registry/auth settings and try again.",
                })
              }
              show(props.api)
              return
            }

            props.api.ui.toast({
              variant: "success",
              message: `Installed ${mod} (${global() ? "global" : "local"}: ${out.dir})`,
            })
            if (!out.tui) {
              props.api.ui.toast({
                variant: "info",
                message: "Package has no TUI target to load in this app.",
              })
              show(props.api)
              return
            }

            return props.api.plugins.add(mod).then((ok) => {
              if (!ok) {
                props.api.ui.toast({
                  variant: "warning",
                  message: "Installed plugin, but runtime load failed. See console/logs; restart TUI to retry.",
                })
                show(props.api)
                return
              }

              props.api.ui.toast({
                variant: "success",
                message: `Loaded ${mod} in current session.`,
              })
              show(props.api)
            })
          })
          .finally(() => {
            setBusy(false)
          })
      }}
      onCancel={() => {
        show(props.api)
      }}
    />
  )
}

function row(api: TuiPluginApi, item: TuiPluginStatus, width: number): DialogSelectOption<string> {
  const isServerOnly = item.target === "server"
  return {
    title: item.id,
    value: item.id,
    category: item.source === "internal" ? "Internal" : isServerOnly ? "Server" : "External",
    description: meta(item, width),
    footer: state(api, item),
    disabled: item.id === id || isServerOnly,
  }
}

function showInstall(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <Install api={api} />)
}

function showErrors(api: TuiPluginApi, pluginId: string) {
  api.ui.dialog.replace(() => <ViewErrors api={api} pluginId={pluginId} onClose={() => show(api)} />)
}

function showValidation(api: TuiPluginApi, pluginId: string) {
  api.ui.dialog.replace(() => <ViewValidation api={api} pluginId={pluginId} onClose={() => show(api)} />)
}

function showHooks(api: TuiPluginApi, pluginId: string) {
  api.ui.dialog.replace(() => <ViewHooks api={api} pluginId={pluginId} onClose={() => show(api)} />)
}

function View(props: { api: TuiPluginApi }) {
  const size = useTerminalDimensions()
  const [refresh, setRefresh] = createSignal(0)
  const [cur, setCur] = createSignal<string | undefined>()
  const [lock, setLock] = createSignal(false)

  createEffect(() => {
    const width = size().width
    if (width >= 128) {
      props.api.ui.dialog.setSize("xlarge")
      return
    }
    if (width >= 96) {
      props.api.ui.dialog.setSize("large")
      return
    }
    props.api.ui.dialog.setSize("medium")
    refresh()
  })

  const list = () => {
    refresh()
    return props.api.plugins.list()
  }

  const rows = createMemo(() =>
    [...list()]
      .sort((a, b) => {
        const x = a.source === "internal" ? 1 : 0
        const y = b.source === "internal" ? 1 : 0
        if (x !== y) return x - y
        return a.id.localeCompare(b.id)
      })
      .map((item) => row(props.api, item, size().width)),
  )

  const flip = (x: string) => {
    if (lock()) return
    const item = list().find((entry) => entry.id === x)
    if (!item) return
    if (item.target === "server") {
      props.api.ui.toast({
        variant: "info",
        message: "Server-only plugins cannot be toggled from TUI",
      })
      return
    }
    setLock(true)
    const task = item.active ? props.api.plugins.deactivate(x) : props.api.plugins.activate(x)
    task
      .then((ok) => {
        if (!ok) {
          props.api.ui.toast({
            variant: "error",
            message: `Failed to update plugin ${item.id}`,
          })
        }
        setRefresh((r) => r + 1)
      })
      .finally(() => {
        setLock(false)
      })
  }

  return (
    <DialogSelect
      title="Plugins"
      options={rows()}
      current={cur()}
      onMove={(item) => setCur(item.value)}
      keybind={[
        {
          title: "toggle",
          keybind: key,
          disabled: lock(),
          onTrigger: (item) => {
            setCur(item.value)
            flip(item.value)
          },
        },
        {
          title: "install",
          keybind: add,
          disabled: lock(),
          onTrigger: () => {
            showInstall(props.api)
          },
        },
        {
          title: "validate",
          keybind: validateKey,
          disabled: lock(),
          onTrigger: (item) => {
            const pluginId = item.value
            if (!pluginId) return
            setCur(pluginId)
            showValidation(props.api, pluginId)
          },
        },
        {
          title: "hooks",
          keybind: hooksKey,
          disabled: lock(),
          onTrigger: (item) => {
            const pluginId = item.value
            if (!pluginId) return
            setCur(pluginId)
            showHooks(props.api, pluginId)
          },
        },
        {
          title: "errors",
          keybind: errorsKey,
          disabled: lock(),
          onTrigger: (item) => {
            const pluginId = item.value
            if (!pluginId) return
            setCur(pluginId)
            showErrors(props.api, pluginId)
          },
        },
      ]}
      onSelect={(item) => {
        setCur(item.value)
        flip(item.value)
      }}
    />
  )
}

function show(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <View api={api} />)
}

const tui: TuiPlugin = async (api) => {
  const off = Plugin.onError((error) => {
    addRecentError("all", error)
    api.ui.toast({
      variant: "error",
      message: getPluginErrorMessage(error),
    })
  })

  api.lifecycle.onDispose(() => {
    off()
  })

  api.command.register(() => [
    {
      title: "Plugins",
      value: "plugins.list",
      keybind: "plugin_manager",
      category: "System",
      onSelect() {
        show(api)
      },
    },
    {
      title: "Install plugin",
      value: "plugins.install",
      category: "System",
      onSelect() {
        showInstall(api)
      },
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
