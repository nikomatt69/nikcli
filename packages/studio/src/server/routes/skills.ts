import { Hono } from "hono"
import fs from "fs"
import path from "path"
import { getSkillDirs, loadSkillsFromDir, parseFrontmatter, buildFrontmatter } from "../config-loader"
import { getStudioConfig, saveStudioConfig } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

export function SkillsRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    const dirs = getSkillDirs()
    const allSkills: any[] = []
    const disabled = getStudioConfig().disabledSkills
    for (const dir of dirs) {
      const skills = loadSkillsFromDir(dir)
      for (const skill of skills) {
        allSkills.push({ ...skill, disabled: disabled.includes(skill.name) })
      }
    }
    return c.json({ skills: allSkills })
  })

  app.get("/:name/content", (c) => {
    const { name } = c.req.param()
    const dirs = getSkillDirs()
    for (const dir of dirs) {
      const skills = loadSkillsFromDir(dir)
      const skill = skills.find((s) => s.name === name)
      if (skill) {
        return c.json(skill)
      }
    }
    return c.json({ error: "Skill not found" }, 404)
  })

  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string; description?: string; category?: string; tags?: string[]; content?: string; scope?: string }>()
    if (!body.name) return c.json({ error: "Name required" }, 400)
    const dirs = getSkillDirs()
    const root = dirs[0]?.root || path.join(process.env.HOME || "", ".config", "nikcli")
    const scopeDir = body.scope === "project" ? process.cwd() : root
    const skillDir = path.join(scopeDir, "skill")
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true })
    const skillPath = path.join(skillDir, `${body.name}`, "SKILL.md")
    const frontmatter = { name: body.name, description: body.description || "", category: body.category, tags: body.tags || [] }
    const fileContent = buildFrontmatter(frontmatter, body.content || "")
    atomicWriteFileSync(skillPath, fileContent)
    return c.json({ success: true, path: skillPath })
  })

  app.put("/:name", async (c) => {
    const { name } = c.req.param()
    const body = await c.req.json<{ content?: string; description?: string; category?: string; tags?: string[] }>()
    const dirs = getSkillDirs()
    for (const dir of dirs) {
      const skills = loadSkillsFromDir(dir)
      const skill = skills.find((s) => s.name === name)
      if (skill) {
        const { data } = parseFrontmatter(fs.readFileSync(skill.path, "utf8"))
        const updated = {
          ...data,
          name,
          description: body.description ?? data.description,
          category: body.category ?? data.category,
          tags: body.tags ?? data.tags,
        }
        const fileContent = buildFrontmatter(updated, body.content || skill.content)
        atomicWriteFileSync(skill.path, fileContent)
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Skill not found" }, 404)
  })

  app.delete("/:name", (c) => {
    const { name } = c.req.param()
    const dirs = getSkillDirs()
    for (const dir of dirs) {
      const skills = loadSkillsFromDir(dir)
      const skill = skills.find((s) => s.name === name)
      if (skill) {
        fs.unlinkSync(skill.path)
        return c.json({ success: true })
      }
    }
    return c.json({ error: "Skill not found" }, 404)
  })

  app.post("/import", async (c) => {
    const { urls } = await c.req.json<{ urls: string[] }>()
    const results: { url: string; success: boolean; name?: string; error?: string }[] = []
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (!response.ok) {
          results.push({ url, success: false, error: `HTTP ${response.status}` })
          continue
        }
        const content = await response.text()
        const { data, body } = parseFrontmatter(content)
        const name = data.name || path.basename(url).replace(/[?#].*$/, "").replace(/\.md$/i, "")
        const dirs = getSkillDirs()
        const root = dirs[0]?.root || path.join(process.env.HOME || "", ".config", "nikcli")
        const skillDir = path.join(root, "skill", name)
        if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true })
        const skillPath = path.join(skillDir, "SKILL.md")
        atomicWriteFileSync(skillPath, content)
        results.push({ url, success: true, name })
      } catch (e: any) {
        results.push({ url, success: false, error: e.message })
      }
    }
    return c.json({ results })
  })

  app.post("/:name/toggle", (c) => {
    const { name } = c.req.param()
    const studio = getStudioConfig()
    const idx = studio.disabledSkills.indexOf(name)
    if (idx >= 0) {
      studio.disabledSkills.splice(idx, 1)
    } else {
      studio.disabledSkills.push(name)
    }
    saveStudioConfig(studio)
    return c.json({ disabled: idx < 0, disabledSkills: studio.disabledSkills })
  })

  return app
}
