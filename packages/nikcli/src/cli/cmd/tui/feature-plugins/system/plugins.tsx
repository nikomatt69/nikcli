import { Keybind } from "@/util/keybind"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiPluginStatus } from "@nikcli-ai/plugin/tui"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { fileURLToPath } from "url"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { PLUGIN_CATALOG } from "./plugin-catalog"

type PluginRowValue = { kind: "installed"; id: string } | { kind: "catalog"; pkg: string }

const id = "internal:plugin-manager"
const key = Keybind.parse("space").at(0)
const add = Keybind.parse("shift+i").at(0)
const tab = Keybind.parse("tab").at(0)

function state(api: TuiPluginApi, item: TuiPluginStatus) {
  if (!item.enabled) {
    return <span style={{ fg: api.theme.current.textMuted }}>disabled</span>
  }

  if (item.target === "server") {
    return <span style={{ fg: api.theme.current.textMuted }}>server</span>
  }

  return (
    <span
      style={{
        fg: item.active ? api.theme.current.success : api.theme.current.error,
      }}
    >
      {item.active ? "active" : "inactive"}
    </span>
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

function installedRow(api: TuiPluginApi, item: TuiPluginStatus, width: number): DialogSelectOption<PluginRowValue> {
  const isServerOnly = item.target === "server"
  return {
    title: item.id,
    value: { kind: "installed", id: item.id },
    category: item.source === "internal" ? "Internal" : isServerOnly ? "Server" : "External",
    description: meta(item, width),
    footer: state(api, item),
    disabled: item.id === id || isServerOnly,
  }
}

function showInstall(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <Install api={api} />)
}

function View(props: { api: TuiPluginApi }) {
  const size = useTerminalDimensions()
  const [refresh, setRefresh] = createSignal(0)
  const [cur, setCur] = createSignal<PluginRowValue | undefined>()
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

  const rows = createMemo((): DialogSelectOption<PluginRowValue>[] => {
    const loaded = list()
    const installedRows = [...loaded]
      .sort((a, b) => {
        const x = a.source === "internal" ? 1 : 0
        const y = b.source === "internal" ? 1 : 0
        if (x !== y) return x - y
        return a.id.localeCompare(b.id)
      })
      .map((item) => installedRow(props.api, item, size().width))

    const catalogRows = PLUGIN_CATALOG.filter(
      (entry) => !loaded.some((p) => p.spec === entry.pkg || p.id === entry.pkg),
    ).map(
      (entry): DialogSelectOption<PluginRowValue> => ({
        title: entry.name,
        value: { kind: "catalog", pkg: entry.pkg },
        category: "Catalog",
        description: entry.description,
        footer: <span style={{ fg: props.api.theme.current.textMuted }}>not installed</span>,
      }),
    )

    return [...installedRows, ...catalogRows]
  })

  function installFromCatalog(pkg: string) {
    if (lock()) return
    setLock(true)
    props.api.plugins
      .install(pkg, { global: false })
      .then((out) => {
        if (!out.ok) {
          props.api.ui.toast({ variant: "error", message: out.message })
          if (out.missing) {
            props.api.ui.toast({
              variant: "info",
              message: "Check npm registry/auth settings and try again.",
            })
          }
          return
        }
        props.api.ui.toast({
          variant: "success",
          message: `Installed ${pkg} (local: ${out.dir})`,
        })
        if (!out.tui) {
          props.api.ui.toast({
            variant: "info",
            message: `${pkg} has no TUI target.`,
          })
          return
        }
        return props.api.plugins.add(pkg).then((ok) => {
          if (!ok) {
            props.api.ui.toast({
              variant: "warning",
              message: `Installed ${pkg} but runtime load failed — restart TUI to retry.`,
            })
            return
          }
          props.api.ui.toast({
            variant: "success",
            message: `${pkg} loaded in current session.`,
          })
          setRefresh((r) => r + 1)
          setCur({ kind: "installed", id: pkg })
        })
      })
      .finally(() => {
        setLock(false)
      })
  }

  const flip = (x: PluginRowValue) => {
    if (x.kind === "catalog") {
      installFromCatalog(x.pkg)
      return
    }
    if (lock()) return
    const item = list().find((entry) => entry.id === x.id)
    if (!item) return
    if (item.target === "server") {
      props.api.ui.toast({
        variant: "info",
        message: "Server-only plugins cannot be toggled from TUI",
      })
      return
    }
    setLock(true)
    const task = item.active ? props.api.plugins.deactivate(x.id) : props.api.plugins.activate(x.id)
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
          disabled: lock() || cur()?.kind === "catalog",
          onTrigger: (item) => {
            setCur(item.value)
            flip(item.value)
          },
        },
        {
          title: "install",
          keybind: add,
          disabled: lock(),
          onTrigger: (item) => {
            if (item.value.kind === "catalog") {
              flip(item.value)
            } else {
              showInstall(props.api)
            }
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
  api.keymap.registerLayer({
    commands: [
      {
        name: "plugins.list",
        title: "Plugins",
        namespace: "System",
        run() {
          show(api)
        },
      },
      {
        name: "plugins.install",
        title: "Install plugin",
        namespace: "System",
        run() {
          showInstall(api)
        },
      },
    ],
    bindings: [{ key: "plugin_manager", cmd: "plugins.list" }],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
