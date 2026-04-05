import fs from "fs"
import path from "path"
import os from "os"
import YAML from "yaml"
import { atomicWriteFileSync } from "./atomic"

const HOME_DIR = os.homedir()

const STUDIO_CONFIG_PATH = path.join(HOME_DIR, ".config", "nikcli-studio", "studio.json")

export interface StudioConfig {
  configPath: string | null
  profiles: Record<string, string>
  activeProfile: string
  disabledSkills: string[]
  disabledPlugins: string[]
  disabledAgents: string[]
  githubRepo: string | null
}

export function getStudioConfig(): StudioConfig {
  const defaults: StudioConfig = {
    configPath: null,
    profiles: {},
    activeProfile: "default",
    disabledSkills: [],
    disabledPlugins: [],
    disabledAgents: [],
    githubRepo: null,
  }
  if (!fs.existsSync(STUDIO_CONFIG_PATH)) return defaults
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(STUDIO_CONFIG_PATH, "utf8")) }
  } catch {
    return defaults
  }
}

export function saveStudioConfig(config: StudioConfig): boolean {
  try {
    const dir = path.dirname(STUDIO_CONFIG_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    atomicWriteFileSync(STUDIO_CONFIG_PATH, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

export function getNikcliConfigPath(): string | null {
  const candidates = [
    path.join(HOME_DIR, ".config", "nikcli", "nikcli.json"),
    path.join(HOME_DIR, ".nikcli", "nikcli.json"),
    path.join(HOME_DIR, ".config", "opencode", "opencode.json"),
    path.join(HOME_DIR, ".opencode", "opencode.json"),
    path.join(HOME_DIR, ".local", "share", "nikcli", "nikcli.json"),
    path.join(HOME_DIR, ".local", "share", "opencode", "opencode.json"),
  ]
  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "nikcli", "nikcli.json"))
    candidates.push(path.join(process.env.APPDATA, "opencode", "opencode.json"))
  }
  const studio = getStudioConfig()
  if (studio.configPath && fs.existsSync(studio.configPath)) return studio.configPath
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

export function getSearchRoots(): string[] {
  const configPath = getNikcliConfigPath()
  const roots: string[] = []
  if (configPath) roots.push(path.dirname(configPath))
  roots.push(process.cwd())
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) roots.push(path.join(xdg, "nikcli"))
  roots.push(path.join(HOME_DIR, ".config", "nikcli"))
  roots.push(path.join(HOME_DIR, ".nikcli"))
  roots.push(path.join(HOME_DIR, ".config", "opencode"))
  roots.push(path.join(HOME_DIR, ".opencode"))
  roots.push(path.join(HOME_DIR, ".local", "share", "nikcli"))
  roots.push(path.join(HOME_DIR, ".local", "share", "opencode"))
  if (process.platform === "win32" && process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "nikcli"))
    roots.push(path.join(process.env.APPDATA, "opencode"))
  }
  return [...new Set(roots.filter(Boolean).map((p) => path.resolve(p)))]
}

export function loadNikcliConfig(): Record<string, any> | null {
  const configPath = getNikcliConfigPath()
  if (!configPath || !fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"))
  } catch {
    return null
  }
}

export function saveNikcliConfig(config: Record<string, any>): boolean {
  const configPath = getNikcliConfigPath()
  if (!configPath) return false
  try {
    atomicWriteFileSync(configPath, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

export function getSkillDirs(): Array<{ path: string; root: string }> {
  const roots = getSearchRoots()
  const dirs: Array<{ path: string; root: string }> = []
  for (const root of roots) {
    for (const sub of ["skill", "skills", ".nikcli/skill", ".nikcli/skills"]) {
      const p = path.join(root, sub)
      if (fs.existsSync(p)) dirs.push({ path: p, root })
    }
  }
  return dirs
}

export function getPluginDirs(): Array<{ path: string; root: string }> {
  const roots = getSearchRoots()
  const dirs: Array<{ path: string; root: string }> = []
  for (const root of roots) {
    for (const sub of ["plugin", "plugins", ".nikcli/plugin", ".nikcli/plugins"]) {
      const p = path.join(root, sub)
      if (fs.existsSync(p)) dirs.push({ path: p, root })
    }
  }
  return dirs
}

export function getAgentDirs(): string[] {
  const roots = getSearchRoots()
  const dirs: string[] = []
  for (const root of roots) {
    dirs.push(path.join(root, "agent"))
    dirs.push(path.join(root, "agents"))
    dirs.push(path.join(root, ".nikcli", "agent"))
    dirs.push(path.join(root, ".nikcli", "agents"))
  }
  return [...new Set(dirs)]
}

export function getCommandDirs(): string[] {
  const roots = getSearchRoots()
  const dirs: string[] = []
  for (const root of roots) {
    dirs.push(path.join(root, "command"))
    dirs.push(path.join(root, "commands"))
    dirs.push(path.join(root, ".nikcli", "command"))
    dirs.push(path.join(root, ".nikcli", "commands"))
  }
  return [...new Set(dirs)]
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  root: string
  category?: string
  tags?: string[]
  content: string
}

export function loadSkillsFromDir(dir: { path: string; root: string }): SkillInfo[] {
  const skills: SkillInfo[] = []
  if (!fs.existsSync(dir.path)) return skills
  try {
    const entries = fs.readdirSync(dir.path, { withFileTypes: true })
    for (const entry of entries) {
      let skillPath: string
      let name: string
      if (entry.isDirectory()) {
        skillPath = path.join(dir.path, entry.name, "SKILL.md")
        name = entry.name
      } else if (entry.name === "SKILL.md" && path.basename(dir.path) !== "skills") {
        skillPath = path.join(dir.path, "SKILL.md")
        name = path.basename(dir.path)
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
        skillPath = path.join(dir.path, entry.name)
        name = path.basename(entry.name, ".md")
      } else {
        continue
      }
      if (!fs.existsSync(skillPath)) continue
      try {
        const content = fs.readFileSync(skillPath, "utf8")
        const { data, body } = parseFrontmatter(content)
        skills.push({
          name,
          description: data.description || body.slice(0, 100).replace(/\n/g, " "),
          path: skillPath,
          root: dir.root,
          category: data.category,
          tags: data.tags,
          content: body,
        })
      } catch {}
    }
  } catch {}
  return skills
}

export interface PluginInfo {
  name: string
  path: string
  root: string
  filename: string
}

export function loadPluginsFromDir(dir: { path: string; root: string }): PluginInfo[] {
  const plugins: PluginInfo[] = []
  if (!fs.existsSync(dir.path)) return plugins
  try {
    const files = fs.readdirSync(dir.path)
      .filter((f) => f.endsWith(".js") || f.endsWith(".ts"))
    for (const file of files) {
      const filePath = path.join(dir.path, file)
      plugins.push({
        name: path.basename(file, path.extname(file)),
        path: filePath,
        root: dir.root,
        filename: file,
      })
    }
  } catch {}
  return plugins
}

export interface AgentInfo {
  name: string
  path: string
  root: string
  description?: string
  mode?: string
  model?: string
  content: string
}

export function loadAgentsFromDir(dir: string): AgentInfo[] {
  const agents: AgentInfo[] = []
  if (!fs.existsSync(dir)) return agents
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
    for (const file of files) {
      const filePath = path.join(dir, file)
      const content = fs.readFileSync(filePath, "utf8")
      const { data, body } = parseFrontmatter(content)
      agents.push({
        name: path.basename(file, ".md"),
        path: filePath,
        root: path.dirname(dir),
        description: data.description,
        mode: data.mode,
        model: data.model,
        content: body,
      })
    }
  } catch {}
  return agents
}

export interface CommandInfo {
  name: string
  path: string
  root: string
  description?: string
  template: string
}

export function loadCommandsFromDir(dir: string): CommandInfo[] {
  const commands: CommandInfo[] = []
  if (!fs.existsSync(dir)) return commands
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
    for (const file of files) {
      const filePath = path.join(dir, file)
      const content = fs.readFileSync(filePath, "utf8")
      const { data, body } = parseFrontmatter(content)
      commands.push({
        name: path.basename(file, ".md"),
        path: filePath,
        root: path.dirname(dir),
        description: data.description || body.slice(0, 100).replace(/\n/g, " "),
        template: body,
      })
    }
  } catch {}
  return commands
}

export function parseFrontmatter(content: string): { data: Record<string, any>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, body: content }
  try {
    const data = YAML.parse(match[1]) || {}
    return { data, body: match[2]?.trim() || "" }
  } catch {
    return { data: {}, body: content }
  }
}

export function buildFrontmatter(data: Record<string, any>, body: string): string {
  const yamlText = YAML.stringify(data, { lineWidth: 120 })
  return `---\n${yamlText}---\n\n${body}`
}
