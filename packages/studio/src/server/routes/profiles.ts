import { Hono } from "hono"
import fs from "fs"
import path from "path"
import os from "os"
import { getStudioConfig, saveStudioConfig, loadNikcliConfig, saveNikcliConfig } from "../config-loader"

const HOME_DIR = os.homedir()
const PROFILES_DIR = path.join(HOME_DIR, ".config", "nikcli-studio", "profiles")

export function ProfilesRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    const studio = getStudioConfig()
    const profiles: Record<string, any> = {}
    const dirs = fs.existsSync(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR) : []
    for (const dir of dirs) {
      if (!dir.endsWith(".json")) continue
      const profilePath = path.join(PROFILES_DIR, dir)
      try {
        const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"))
        const name = dir.replace(".json", "")
        profiles[name] = {
          name,
          path: profilePath,
          mcpCount: profile.mcp ? Object.keys(profile.mcp).length : 0,
          plugins: profile.plugin || [],
          providerCount: profile.provider ? Object.keys(profile.provider).length : 0,
        }
      } catch {}
    }
    return c.json({ profiles, activeProfile: studio.activeProfile })
  })

  app.post("/", async (c) => {
    const { name } = await c.req.json<{ name: string }>()
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return c.json({ error: "Invalid profile name" }, 400)
    }
    const config = loadNikcliConfig() || {}
    const profilePath = path.join(PROFILES_DIR, `${name}.json`)
    if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true })
    fs.writeFileSync(profilePath, JSON.stringify(config, null, 2))
    const studio = getStudioConfig()
    studio.profiles[name] = profilePath
    saveStudioConfig(studio)
    return c.json({ success: true, path: profilePath })
  })

  app.post("/activate/:name", (c) => {
    const { name } = c.req.param()
    const profilePath = path.join(PROFILES_DIR, `${name}.json`)
    if (!fs.existsSync(profilePath)) return c.json({ error: "Profile not found" }, 404)
    try {
      const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"))
      saveNikcliConfig(profile)
      const studio = getStudioConfig()
      studio.activeProfile = name
      saveStudioConfig(studio)
      return c.json({ success: true })
    } catch {
      return c.json({ error: "Failed to activate profile" }, 500)
    }
  })

  app.post("/save/:name", (c) => {
    const { name } = c.req.param()
    const profilePath = path.join(PROFILES_DIR, `${name}.json`)
    const config = loadNikcliConfig()
    if (!config) return c.json({ error: "No config to save" }, 400)
    try {
      if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true })
      fs.writeFileSync(profilePath, JSON.stringify(config, null, 2))
      return c.json({ success: true })
    } catch {
      return c.json({ error: "Failed to save profile" }, 500)
    }
  })

  app.delete("/:name", (c) => {
    const { name } = c.req.param()
    const profilePath = path.join(PROFILES_DIR, `${name}.json`)
    if (!fs.existsSync(profilePath)) return c.json({ error: "Profile not found" }, 404)
    fs.unlinkSync(profilePath)
    const studio = getStudioConfig()
    delete studio.profiles[name]
    saveStudioConfig(studio)
    return c.json({ success: true })
  })

  return app
}
