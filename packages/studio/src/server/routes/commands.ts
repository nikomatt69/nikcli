import { Hono } from "hono"
import fs from "fs"
import path from "path"
import os from "os"
import { getCommandDirs, loadCommandsFromDir, parseFrontmatter, buildFrontmatter } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

const HOME_DIR = os.homedir()

export function CommandsRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    const dirs = getCommandDirs()
    const allCommands: any[] = []
    for (const dir of dirs) {
      const commands = loadCommandsFromDir(dir)
      allCommands.push(...commands)
    }
    return c.json({ commands: allCommands })
  })

  app.get("/:name", (c) => {
    const { name } = c.req.param()
    const dirs = getCommandDirs()
    for (const dir of dirs) {
      const commands = loadCommandsFromDir(dir)
      const cmd = commands.find((c) => c.name === name)
      if (cmd) return c.json({ ...cmd })
    }
    return c.json({ error: "Command not found" }, 404)
  })

  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string; description?: string; template?: string; scope?: string }>()
    if (!body.name) return c.json({ error: "Name required" }, 400)
    const dirs = getCommandDirs()
    const root = dirs[0] ? path.dirname(dirs[0]) : path.join(HOME_DIR, ".config", "nikcli")
    const commandDir = path.join(root, "command")
    if (!fs.existsSync(commandDir)) fs.mkdirSync(commandDir, { recursive: true })
    const cmdPath = path.join(commandDir, `${body.name}.md`)
    const frontmatter = { description: body.description || "" }
    atomicWriteFileSync(cmdPath, buildFrontmatter(frontmatter, body.template || ""))
    return c.json({ success: true, path: cmdPath })
  })

  app.put("/:name", async (c) => {
    const { name } = c.req.param()
    const body = await c.req.json<{ description?: string; template?: string }>()
    const dirs = getCommandDirs()
    for (const dir of dirs) {
      const commands = loadCommandsFromDir(dir)
      const cmd = commands.find((c) => c.name === name)
      if (cmd) {
        const { data } = parseFrontmatter(fs.readFileSync(cmd.path, "utf8"))
        const updated = { ...data, description: body.description ?? data.description }
        atomicWriteFileSync(cmd.path, buildFrontmatter(updated, body.template || cmd.template))
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Command not found" }, 404)
  })

  app.delete("/:name", (c) => {
    const { name } = c.req.param()
    const dirs = getCommandDirs()
    for (const dir of dirs) {
      const commands = loadCommandsFromDir(dir)
      const cmd = commands.find((c) => c.name === name)
      if (cmd) {
        fs.unlinkSync(cmd.path)
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Command not found" }, 404)
  })

  return app
}
