import { Hono } from "hono"
import { execSync } from "child_process"
import { getStudioConfig, saveStudioConfig, getNikcliConfigPath } from "../config-loader"

export function GitHubRoutes() {
  const app = new Hono()

  function ghAvailable(): boolean {
    try {
      execSync("gh auth status", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  app.get("/", (c) => {
    const available = ghAvailable()
    const studio = getStudioConfig()
    return c.json({ available, repo: studio.githubRepo || null })
  })

  app.get("/status", (c) => {
    const available = ghAvailable()
    const studio = getStudioConfig()
    return c.json({ available, repo: studio.githubRepo || null })
  })

  app.post("/sync/push", async (c) => {
    if (!ghAvailable()) return c.json({ error: "GitHub CLI not available" }, 400)
    const { message } = await c.req.json<{ message?: string }>()
    const configPath = getNikcliConfigPath()
    try {
      execSync(`gh gist create "${configPath}" --public false --desc "nikcli config backup"`, { stdio: "ignore" })
      return c.json({ success: true })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.post("/sync/pull", async (c) => {
    if (!ghAvailable()) return c.json({ error: "GitHub CLI not available" }, 400)
    return c.json({ error: "Pull from gist not yet implemented" }, 501)
  })

  app.post("/repo", async (c) => {
    const { repo } = await c.req.json<{ repo?: string }>()
    const studio = getStudioConfig()
    studio.githubRepo = repo || null
    saveStudioConfig(studio)
    return c.json({ success: true, repo: studio.githubRepo })
  })

  return app
}
