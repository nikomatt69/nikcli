import { describe, expect, it } from "bun:test"
import type { TuiCommand, TuiPluginApi } from "@nikcli-ai/plugin/tui"
import { createKeymapApi } from "@tui/plugin/keymap"

function fakeCommandApi() {
  const registrations: Array<() => TuiCommand[]> = []
  const triggered: string[] = []
  let shown = 0
  const command: TuiPluginApi["command"] = {
    register(cb) {
      registrations.push(cb)
      return () => {
        const idx = registrations.indexOf(cb)
        if (idx !== -1) registrations.splice(idx, 1)
      }
    },
    trigger(value) {
      triggered.push(value)
      for (const cb of registrations) {
        for (const row of cb()) {
          if (row.value === value) row.onSelect?.()
        }
      }
    },
    show() {
      shown += 1
    },
  }
  return {
    command,
    rows: () => registrations.flatMap((cb) => cb()),
    triggered,
    shownCount: () => shown,
  }
}

describe("tui plugin keymap", () => {
  it("maps layer commands to command rows with slash and namespace", () => {
    const host = fakeCommandApi()
    const keymap = createKeymapApi(host.command)
    let ran = 0

    keymap.registerLayer({
      commands: [
        {
          name: "plugin.command",
          title: "Plugin Command",
          namespace: "palette",
          slashName: "plugin",
          slashAliases: ["plg"],
          run: () => ran++,
        },
      ],
      bindings: [{ key: "ctrl+shift+p", cmd: "plugin.command" }],
    })

    const rows = host.rows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      value: "plugin.command",
      title: "Plugin Command",
      category: "palette",
      keybind: "ctrl+shift+p",
      slash: { name: "plugin", aliases: ["plg"] },
    })

    rows[0]!.onSelect?.()
    expect(ran).toBe(1)
  })

  it("turns extra and foreign bindings into hidden alias rows", () => {
    const host = fakeCommandApi()
    const keymap = createKeymapApi(host.command)
    let inline = 0

    keymap.registerLayer({
      commands: [{ name: "plugin.command", title: "Plugin Command", run: () => {} }],
      bindings: [
        { key: "ctrl+1", cmd: "plugin.command" },
        { key: "ctrl+2", cmd: "plugin.command" },
        { key: "ctrl+3", cmd: "host.command" },
        { key: "ctrl+4", cmd: () => inline++ },
      ],
    })

    const rows = host.rows()
    const aliases = rows.filter((row) => row.hidden)
    expect(aliases).toHaveLength(3)
    expect(rows.find((row) => row.value === "plugin.command")?.keybind).toBe("ctrl+1")

    aliases.find((row) => row.keybind === "ctrl+3")!.onSelect?.()
    expect(host.triggered).toContain("host.command")

    aliases.find((row) => row.keybind === "ctrl+4")!.onSelect?.()
    expect(inline).toBe(1)
  })

  it("dispatchCommand triggers by name and opens the palette for command.palette.show", () => {
    const host = fakeCommandApi()
    const keymap = createKeymapApi(host.command)

    keymap.dispatchCommand("some.command")
    expect(host.triggered).toEqual(["some.command"])

    keymap.dispatchCommand("command.palette.show")
    expect(host.shownCount()).toBe(1)
  })

  it("registerLayer returns an unregister function", () => {
    const host = fakeCommandApi()
    const keymap = createKeymapApi(host.command)

    const unregister = keymap.registerLayer({
      commands: [{ name: "plugin.command", title: "Plugin Command", run: () => {} }],
    })
    expect(host.rows()).toHaveLength(1)

    unregister()
    expect(host.rows()).toHaveLength(0)
  })
})
