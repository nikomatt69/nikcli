/**
 * Math rendering — internal TUI plugin.
 *
 * Mirrors `feature-plugins/background`: a self-contained plugin that owns one
 * feature end to end. It renders LaTeX math in assistant messages (`$…$`,
 * `$$…$$`) as Unicode formulas through `@nikcli-ai/tui-math` instead of
 * painting the raw source, and registers the `/math` command that toggles it.
 *
 * Off by default: while a message streams, the math path re-splits the whole
 * text on every chunk and swaps markdown blocks for formula renderables as
 * delimiters open and close, which flickers on fast streams. The flag lives
 * in the TUI key-value store so the toggle applies live, without a config
 * round-trip.
 *
 * The plugin owns the settings and the command, but *not* the mounting: the
 * session route renders {@link ./markdown#MessageMarkdown} itself, the same
 * way `app.tsx` mounts the background image — a slot would put a
 * `SlotRenderable` between the message and the markdown and break the
 * streaming fast path.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { readEnabled, writeEnabled } from "./store"

const id = "internal:math"

const tui: TuiPlugin = async (api) => {
  // The runtime scopes the registration to the plugin's lifetime.
  api.keymap.registerLayer({
    commands: () => {
      const enabled = readEnabled(api.kv)
      return [
        {
          name: "math.toggle",
          title: enabled ? "Math rendering: on" : "Math rendering: off",
          namespace: "Appearance",
          description: "Render LaTeX math in messages as Unicode formulas instead of raw source",
          slashName: "math",
          slashAliases: ["latex", "tex"],
          run() {
            const next = writeEnabled(api.kv, !readEnabled(api.kv))
            api.ui.toast({
              variant: "info",
              message: next
                ? "Math rendering on — LaTeX formulas render as Unicode math"
                : "Math rendering off — $…$ stays raw source",
            })
          },
        },
      ]
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
