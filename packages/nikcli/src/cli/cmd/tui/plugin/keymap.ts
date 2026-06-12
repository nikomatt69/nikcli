import type { TuiCommand, TuiKeymapLayer, TuiKeymapApi, TuiPluginApi } from "@nikcli-ai/plugin/tui"

let layers = 0

/**
 * Builds the v2 keymap surface on top of a command registry. Bindings are
 * decoupled from commands: a binding can target a command by name (including
 * commands owned by the host or other layers) or carry an inline handler.
 */
export function createKeymapApi(command: TuiPluginApi["command"]): TuiKeymapApi {
  return {
    registerLayer(layer: TuiKeymapLayer) {
      const id = `keymap:${++layers}`
      const commands = layer.commands ?? []
      const bindings = layer.bindings ?? []

      // The command registry holds a single keybind per row, so the first
      // binding for a layer command rides on its row; every other binding
      // becomes a hidden alias row that re-dispatches by name.
      const primary = new Map<string, string>()
      const rows: TuiCommand[] = []
      let extras = 0
      const alias = (key: string, description: string | undefined, run: () => void) => {
        rows.push({
          title: description ?? key,
          value: `${id}:binding:${extras++}`,
          hidden: true,
          keybind: key,
          onSelect: run,
        })
      }

      for (const binding of bindings) {
        const cmd = binding.cmd
        if (typeof cmd === "function") {
          alias(binding.key, binding.description, () => cmd())
          continue
        }
        if (!primary.has(cmd) && commands.some((item) => item.name === cmd)) {
          primary.set(cmd, binding.key)
          continue
        }
        alias(binding.key, binding.description, () => command.trigger(cmd))
      }

      for (const item of commands) {
        rows.push({
          title: item.title,
          value: item.name,
          description: item.description,
          category: item.namespace,
          keybind: primary.get(item.name),
          suggested: item.suggested,
          hidden: item.hidden,
          enabled: item.enabled,
          slash: item.slashName ? { name: item.slashName, aliases: item.slashAliases } : undefined,
          onSelect: () => item.run(),
        })
      }

      return command.register(() => rows)
    },
    dispatchCommand(name: string) {
      if (name === "command.palette.show") {
        command.show()
        return
      }
      command.trigger(name)
    },
  }
}
