import { Hono } from "hono"
import { loadNikcliConfig, saveNikcliConfig, getNikcliConfigPath, getStudioConfig, saveStudioConfig } from "../config-loader"
import { getSearchRoots } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

export function ConfigRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    const config = loadNikcliConfig()
    if (!config) return c.json({ error: "No config found" }, 404)
    return c.json({ ...config, _path: getNikcliConfigPath() })
  })

  app.patch("/", async (c) => {
    const body = await c.req.json<Record<string, any>>()
    const config = loadNikcliConfig() || {}
    const merged = { ...config, ...body }
    if (saveNikcliConfig(merged)) {
      return c.json({ success: true })
    }
    return c.json({ error: "Failed to save config" }, 500)
  })

  app.post("/mcp", async (c) => {
    const { name, config: mcpConfig } = await c.req.json<{ name: string; config: any }>()
    const config = loadNikcliConfig() || {}
    if (!config.mcp) config.mcp = {}
    config.mcp[name] = mcpConfig
    if (saveNikcliConfig(config)) return c.json({ success: true })
    return c.json({ error: "Failed to save" }, 500)
  })

  app.delete("/mcp/:name", (c) => {
    const { name } = c.req.param()
    const config = loadNikcliConfig()
    if (!config) return c.json({ error: "No config" }, 404)
    if (config.mcp?.[name]) delete config.mcp[name]
    if (saveNikcliConfig(config)) return c.json({ success: true })
    return c.json({ error: "Failed to save" }, 500)
  })

  app.patch("/mcp/:name", async (c) => {
    const { name } = c.req.param()
    const patch = await c.req.json<Record<string, any>>()
    const config = loadNikcliConfig()
    if (!config) return c.json({ error: "No config" }, 404)
    if (!config.mcp) config.mcp = {}
    if (!config.mcp[name]) config.mcp[name] = {}
    config.mcp[name] = { ...config.mcp[name], ...patch }
    if (saveNikcliConfig(config)) return c.json({ success: true })
    return c.json({ error: "Failed to save" }, 500)
  })

  app.get("/paths", (c) => {
    const studio = getStudioConfig()
    const paths = getSearchRoots()
    return c.json({ detected: getNikcliConfigPath(), candidates: paths, studio })
  })

  app.post("/paths", async (c) => {
    const { configPath } = await c.req.json<{ configPath: string }>()
    const studio = getStudioConfig()
    studio.configPath = configPath
    saveStudioConfig(studio)
    return c.json({ success: true, current: getNikcliConfigPath() })
  })

  app.get("/providers", async (c) => {
    const config = loadNikcliConfig()
    const providers = config?.provider || {}
    return c.json({ providers })
  })

  app.post("/providers/:id/api", async (c) => {
    const { id } = c.req.param()
    const { apiKey } = await c.req.json<{ apiKey: string }>()
    const config = loadNikcliConfig() || {}
    if (!config.provider) config.provider = {}
    if (!config.provider[id]) config.provider[id] = {}
    config.provider[id].apiKey = apiKey
    if (saveNikcliConfig(config)) return c.json({ success: true })
    return c.json({ error: "Failed to save" }, 500)
  })

  return app
}
