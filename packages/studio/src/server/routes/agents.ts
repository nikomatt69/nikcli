import { Hono } from "hono"
import fs from "fs"
import path from "path"
import os from "os"
import { getAgentDirs, loadAgentsFromDir, parseFrontmatter, buildFrontmatter } from "../config-loader"
import { getStudioConfig, saveStudioConfig } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

const HOME_DIR = os.homedir()

export function AgentsRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    const dirs = getAgentDirs()
    const allAgents: any[] = []
    const disabled = getStudioConfig().disabledAgents
    const builtin = ["build", "plan"]
    for (const dir of dirs) {
      const agents = loadAgentsFromDir(dir)
      for (const agent of agents) {
        allAgents.push({ ...agent, disabled: disabled.includes(agent.name) })
      }
    }
    return c.json({ agents: allAgents, builtin })
  })

  app.get("/:name", (c) => {
    const { name } = c.req.param()
    const dirs = getAgentDirs()
    for (const dir of dirs) {
      const agents = loadAgentsFromDir(dir)
      const agent = agents.find((a) => a.name === name)
      if (agent) return c.json({ ...agent })
    }
    return c.json({ error: "Agent not found" }, 404)
  })

  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string; description?: string; mode?: string; model?: string; prompt?: string; scope?: string }>()
    if (!body.name) return c.json({ error: "Name required" }, 400)
    if (!/^[a-zA-Z0-9 _-]+$/.test(body.name)) return c.json({ error: "Invalid agent name" }, 400)
    const dirs = getAgentDirs()
    const root = dirs[0] ? path.dirname(dirs[0]) : path.join(HOME_DIR, ".config", "nikcli")
    const agentDir = path.join(root, "agents")
    if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true })
    const agentPath = path.join(agentDir, `${body.name}.md`)
    const frontmatter = {
      description: body.description || "",
      mode: body.mode || "primary",
      model: body.model,
    }
    atomicWriteFileSync(agentPath, buildFrontmatter(frontmatter, body.prompt || ""))
    return c.json({ success: true, path: agentPath })
  })

  app.put("/:name", async (c) => {
    const { name } = c.req.param()
    const body = await c.req.json<{ description?: string; mode?: string; model?: string; prompt?: string }>()
    const dirs = getAgentDirs()
    for (const dir of dirs) {
      const agents = loadAgentsFromDir(dir)
      const agent = agents.find((a) => a.name === name)
      if (agent) {
        const { data } = parseFrontmatter(fs.readFileSync(agent.path, "utf8"))
        const updated = {
          ...data,
          name,
          description: body.description ?? data.description,
          mode: body.mode ?? data.mode,
          model: body.model ?? data.model,
        }
        atomicWriteFileSync(agent.path, buildFrontmatter(updated, body.prompt || agent.content))
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Agent not found" }, 404)
  })

  app.delete("/:name", (c) => {
    const { name } = c.req.param()
    const dirs = getAgentDirs()
    for (const dir of dirs) {
      const agents = loadAgentsFromDir(dir)
      const agent = agents.find((a) => a.name === name)
      if (agent) {
        fs.unlinkSync(agent.path)
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Agent not found" }, 404)
  })

  app.post("/:name/toggle", (c) => {
    const { name } = c.req.param()
    const studio = getStudioConfig()
    const idx = studio.disabledAgents.indexOf(name)
    if (idx >= 0) {
      studio.disabledAgents.splice(idx, 1)
    } else {
      studio.disabledAgents.push(name)
    }
    saveStudioConfig(studio)
    return c.json({ disabled: idx < 0 })
  })

  return app
}
