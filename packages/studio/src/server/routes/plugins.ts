import { Hono } from "hono"
import fs from "fs"
import path from "path"
import os from "os"
import { getPluginDirs, loadPluginsFromDir, loadNikcliConfig } from "../config-loader"
import { getStudioConfig, saveStudioConfig } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

const PLUGIN_TEMPLATES = {
  hooks: `export default function myPlugin(input) {
  return {
    // Lifecycle hooks
    async onMessage({ message, client }) {
      // Called for each message
    },
    async onSession({ session }) {
      // Called when a session starts/ends
    },
    async onTool({ tool, input, result }) {
      // Called for each tool call
    },
  }
}
`,
  watcher: `export default function myWatcherPlugin(input) {
  return {
    async onFileChange({ path, event }) {
      // Called when a file changes
    },
    async onBuild({ success }) {
      // Called after build completes
    },
  }
}
`,
  lifecycle: `export default function myLifecyclePlugin(input) {
  return {
    async config(config) {
      // Called when config is loaded
      return config
    },
    async init() {
      // Called when plugin is initialized
    },
    async dispose() {
      // Called when plugin is disposed
    },
  }
}
`,
}

export function PluginsRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    const dirs = getPluginDirs()
    const allPlugins: any[] = []
    const disabled = getStudioConfig().disabledPlugins
    const config = loadNikcliConfig() || {}
    const configuredPlugins = config.plugin || []
    for (const dir of dirs) {
      const plugins = loadPluginsFromDir(dir)
      for (const plugin of plugins) {
        allPlugins.push({
          ...plugin,
          disabled: disabled.includes(plugin.name),
          configured: configuredPlugins.some((p: string) => p.includes(plugin.name)),
        })
      }
    }
    return c.json({ plugins: allPlugins, templates: PLUGIN_TEMPLATES })
  })

  app.get("/templates", (c) => {
    return c.json({ templates: PLUGIN_TEMPLATES })
  })

  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string; template?: string; content?: string }>()
    if (!body.name) return c.json({ error: "Name required" }, 400)
    const dirs = getPluginDirs()
    const root = dirs[0]?.root || path.join(os.homedir(), ".config", "nikcli")
    const pluginDir = path.join(root, "plugin")
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true })
    const filename = `${body.name}.ts`
    const pluginPath = path.join(pluginDir, filename)
    const content = body.content || PLUGIN_TEMPLATES[body.template as keyof typeof PLUGIN_TEMPLATES] || PLUGIN_TEMPLATES.hooks
    atomicWriteFileSync(pluginPath, content)
    return c.json({ success: true, path: pluginPath, filename })
  })

  app.get("/:name", (c) => {
    const { name } = c.req.param()
    const dirs = getPluginDirs()
    for (const dir of dirs) {
      const plugins = loadPluginsFromDir(dir)
      const plugin = plugins.find((p) => p.name === name)
      if (plugin) {
        const content = fs.readFileSync(plugin.path, "utf8")
        return c.json({ ...plugin, content })
      }
    }
    return c.json({ error: "Plugin not found" }, 404)
  })

  app.put("/:name", async (c) => {
    const { name } = c.req.param()
    const { content } = await c.req.json<{ content: string }>()
    const dirs = getPluginDirs()
    for (const dir of dirs) {
      const plugins = loadPluginsFromDir(dir)
      const plugin = plugins.find((p) => p.name === name)
      if (plugin) {
        atomicWriteFileSync(plugin.path, content)
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Plugin not found" }, 404)
  })

  app.delete("/:name", (c) => {
    const { name } = c.req.param()
    const dirs = getPluginDirs()
    for (const dir of dirs) {
      const plugins = loadPluginsFromDir(dir)
      const plugin = plugins.find((p) => p.name === name)
      if (plugin) {
        fs.unlinkSync(plugin.path)
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Plugin not found" }, 404)
  })

  app.post("/:name/toggle", (c) => {
    const { name } = c.req.param()
    const studio = getStudioConfig()
    const idx = studio.disabledPlugins.indexOf(name)
    if (idx >= 0) {
      studio.disabledPlugins.splice(idx, 1)
    } else {
      studio.disabledPlugins.push(name)
    }
    saveStudioConfig(studio)
    return c.json({ disabled: idx < 0, disabledPlugins: studio.disabledPlugins })
  })

  return app
}
