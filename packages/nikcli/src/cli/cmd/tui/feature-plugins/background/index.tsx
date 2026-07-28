/**
 * Background image — internal TUI plugin.
 *
 * Mirrors `feature-plugins/browser`: a self-contained plugin that owns one
 * feature end to end. It paints a real image behind the TUI (truecolor
 * half-blocks, drawn by OpenTUI's native super-sampler) the way a terminal
 * wallpaper would, without needing the terminal to support one, and registers
 * the `/background` command that configures it. Nothing renders until an
 * image is picked.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { sourceLabel } from "./settings"
import { readSettings, rotation, writeSettings } from "./store"
import { DialogBackground, DialogBackgroundPicker } from "./dialog"
import { BackgroundImage } from "./view"
import { dbg } from "./__debug"

const id = "internal:background"

const tui: TuiPlugin = async (api) => {
  dbg("plugin setup")
  // The runtime scopes the registration to the plugin's lifetime.
  api.slots.register({
    slots: {
      app: () => {
        dbg("app slot render")
        return <BackgroundImage />
      },
    },
  })

  api.keymap.registerLayer({
    commands: () => {
      const settings = readSettings(api.kv)
      return [
        {
          name: "background.configure",
          title: "Background image",
          namespace: "Appearance",
          description: settings.source
            ? `Background: ${sourceLabel(settings.source)}`
            : "Paint an image behind the TUI",
          slashName: "background",
          slashAliases: ["bg", "wallpaper"],
          run() {
            api.ui.dialog.replace(() => <DialogBackground />)
          },
        },
        {
          name: "background.choose",
          title: "Choose background image",
          namespace: "Appearance",
          description: "Browse the filesystem and pick an image",
          run() {
            api.ui.dialog.replace(() => <DialogBackgroundPicker />)
          },
        },
        {
          name: "background.toggle",
          title: settings.enabled ? "Hide background image" : "Show background image",
          namespace: "Appearance",
          description: "Keep the image configured but stop painting it",
          enabled: settings.source !== "",
          run() {
            writeSettings(api.kv, { enabled: !readSettings(api.kv).enabled })
          },
        },
        {
          name: "background.shuffle",
          title: "Shuffle background image",
          namespace: "Appearance",
          description: "Pick the next image when the source is a folder",
          enabled: settings.source !== "",
          hidden: settings.source === "",
          run() {
            rotation.next()
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
