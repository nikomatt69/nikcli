import z from "zod"
import path from "path"
import { createHash } from "crypto"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@nikcli-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Bus } from "@/bus"
import { Session } from "@/session"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  const COMMAND_PREFIX = "skill:"

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    version: z.string().optional(),
  })
  const Metadata = Info.omit({
    location: true,
  })
  export type Info = z.infer<typeof Info>
  export type Loaded = Info & {
    dir: string
    content: string
  }

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  // External skill directories to search for (project-level and global)
  // These follow the directory layout used by Claude Code and other agents.
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  const NIKCLI_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const CLAUDE_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")
  const SKILL_GLOB = new Bun.Glob("**/SKILL.md")

  function normalizeName(input: string) {
    return input.toLowerCase().replace(/[^a-z0-9]+/g, "")
  }

  function slug(input: string) {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }

  export function commandName(name: string) {
    const suffix = slug(name) || "skill"
    const hash = createHash("sha1").update(name).digest("hex").slice(0, 6)
    return `${COMMAND_PREFIX}${suffix}-${hash}`
  }

  export function isCommandName(name: string) {
    return name.startsWith(COMMAND_PREFIX)
  }

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Metadata.safeParse(md.data)
      if (!parsed.success) return

      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        category: parsed.data.category,
        tags: parsed.data.tags,
        version: parsed.data.version,
      }
    }

    const scanExternal = async (root: string, scope: "global" | "project") => {
      return Array.fromAsync(
        EXTERNAL_SKILL_GLOB.scan({
          cwd: root,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        }),
      )
        .then((matches) => Promise.all(matches.map(addSkill)))
        .catch((error) => {
          log.error(`failed to scan ${scope} skills`, { dir: root, error })
        })
    }

    // Scan external skill directories (.claude/skills/, .agents/skills/, etc.)
    // Load global (home) first, then project-level (so project-level overwrites)
    if (!Flag.NIKCLI_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        await scanExternal(root, "global")
      }

      for await (const root of Filesystem.up({
        targets: EXTERNAL_DIRS,
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanExternal(root, "project")
      }
    }

    for (const dir of await Config.directories()) {
      for await (const match of NIKCLI_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    return skills
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x))
  }

  export async function resolve(name: string, candidates?: Info[]) {
    const query = name.trim()
    if (!query) return { skill: undefined, suggestions: [] as string[] }

    const list = candidates ?? (await all())
    const lower = query.toLowerCase()
    const normalized = normalizeName(query)

    const exact =
      list.find((skill) => skill.name === query) ??
      list.find((skill) => skill.name.toLowerCase() === lower) ??
      (() => {
        const matches = list.filter((skill) => normalizeName(skill.name) === normalized)
        return matches.length === 1 ? matches[0] : undefined
      })()

    if (exact) {
      return { skill: exact, suggestions: [exact.name] }
    }

    const partial = list.filter((skill) => {
      const skillName = skill.name.toLowerCase()
      const normalizedName = normalizeName(skill.name)
      return skillName.includes(lower) || normalizedName.includes(normalized)
    })

    if (partial.length === 1) {
      return { skill: partial[0], suggestions: partial.map((skill) => skill.name) }
    }

    const related = partial.length
      ? partial
      : list.filter((skill) =>
          [skill.description, skill.category ?? "", ...(skill.tags ?? [])].some((value) =>
            value.toLowerCase().includes(lower),
          ),
        )

    return {
      skill: undefined,
      suggestions: related.slice(0, 5).map((skill) => skill.name),
    }
  }

  export async function load(name: string): Promise<Loaded | undefined> {
    const skill = await get(name)
    if (!skill) return

    const parsed = await ConfigMarkdown.parse(skill.location)
    return {
      ...skill,
      dir: path.dirname(skill.location),
      content: parsed.content.trim(),
    }
  }
}
