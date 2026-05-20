import path from "path"
import fs from "fs/promises"
import { intro, log, outro, spinner, confirm } from "@clack/prompts"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import { Skill } from "../../skill"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"
import { bootstrap } from "../bootstrap"

// ---------------------------------------------------------------------------
// Skill registry: maps GitHub shorthand to npm package or GitHub tarball URL
// ---------------------------------------------------------------------------

const KNOWN_SKILLS: Record<string, string> = {
  "earthtojake/text-to-cad": "https://github.com/earthtojake/text-to-cad/archive/refs/heads/main.tar.gz",
  "vercel-labs/agent-skills": "https://github.com/vercel-labs/agent-skills/archive/refs/heads/main.tar.gz",
  "anthropics/skills": "https://github.com/anthropics/skills/archive/refs/heads/main.tar.gz",
}

// Metalworking skill registry (bundled with nikcli)
const BUILTIN_METALWORKING_SKILLS = [
  "text-to-cad",
  "solidworks-automation",
  "fusion360-api",
  "hypermill-cam",
  "cnc-gcode",
  "metalworking-dfm",
  "cad-formats",
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runSkill<A, E>(effect: Effect.Effect<A, E, Skill.Service>): Promise<A> {
  return runPromiseWithLayer(Skill.defaultLayer, effect)
}

async function listSkills(): Promise<Skill.Info[]> {
  return runSkill(
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      return yield* skill.all()
    }),
  )
}

async function getSkillDir(global: boolean): Promise<string> {
  if (global) {
    return path.join(Global.Path.config, "skills")
  }
  return path.join(process.cwd(), ".nikcli", "skill")
}

async function installFromGitHub(
  owner: string,
  repo: string,
  skillName: string | undefined,
  targetDir: string,
): Promise<{ installed: string[]; errors: string[] }> {
  const installed: string[] = []
  const errors: string[] = []

  const shorthand = `${owner}/${repo}`
  const tarUrl =
    KNOWN_SKILLS[shorthand] ??
    `https://github.com/${owner}/${repo}/archive/refs/heads/main.tar.gz`

  const spin = spinner()
  spin.start(`Downloading ${shorthand}...`)

  try {
    const res = await fetch(tarUrl)
    if (!res.ok) {
      spin.stop(`Download failed: ${res.status} ${res.statusText}`, 1)
      errors.push(`Failed to fetch ${tarUrl}: ${res.status}`)
      return { installed, errors }
    }

    const tarball = await res.arrayBuffer()
    spin.stop(`Downloaded ${(tarball.byteLength / 1024).toFixed(0)} KB`)

    // Extract to temp dir using Bun's tar
    const tmpDir = path.join(Global.Path.config, ".tmp", `skill-install-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    await Bun.write(path.join(tmpDir, "archive.tar.gz"), tarball)

    spin.start("Extracting...")
    const extract = Bun.spawn(["tar", "-xzf", "archive.tar.gz"], { cwd: tmpDir, stderr: "pipe" })
    await extract.exited

    if (extract.exitCode !== 0) {
      const errText = await Bun.readableStreamToText(extract.stderr)
      spin.stop("Extraction failed", 1)
      errors.push(`tar failed: ${errText}`)
      return { installed, errors }
    }
    spin.stop("Extracted")

    // Find SKILL.md files in extracted content
    const glob = new Bun.Glob("**/SKILL.md")
    const skillFiles = await Array.fromAsync(
      glob.scan({ cwd: tmpDir, absolute: true, onlyFiles: true }),
    )

    if (skillFiles.length === 0) {
      errors.push(`No SKILL.md files found in ${shorthand}`)
      return { installed, errors }
    }

    for (const skillFile of skillFiles) {
      try {
        const content = await Bun.file(skillFile).text()
        const nameMatch = content.match(/^name:\s*(.+)$/m)
        const detectedName = nameMatch?.[1]?.trim().replace(/^['"]|['"]$/g, "")

        if (!detectedName) {
          errors.push(`Could not detect skill name in ${skillFile}`)
          continue
        }

        if (skillName && detectedName !== skillName) continue

        const skillDir = path.join(targetDir, detectedName)
        await fs.mkdir(skillDir, { recursive: true })

        // Copy SKILL.md
        await Bun.write(path.join(skillDir, "SKILL.md"), content)

        // Copy references/ directory if present
        const refDir = path.join(path.dirname(skillFile), "references")
        if (await Filesystem.isDir(refDir)) {
          const refGlob = new Bun.Glob("**/*")
          for await (const ref of refGlob.scan({ cwd: refDir, absolute: true, onlyFiles: true })) {
            const rel = path.relative(refDir, ref)
            const dest = path.join(skillDir, "references", rel)
            await fs.mkdir(path.dirname(dest), { recursive: true })
            await Bun.write(dest, await Bun.file(ref).arrayBuffer())
          }
        }

        installed.push(detectedName)
        log.success(`Installed skill: ${detectedName}`)
      } catch (err) {
        errors.push(`Failed to install from ${skillFile}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch (err) {
    spin.stop("Failed", 1)
    errors.push(`Install error: ${err instanceof Error ? err.message : String(err)}`)
  }

  return { installed, errors }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const SkillsAddCommand = cmd({
  command: "add <source>",
  aliases: ["install", "i"],
  describe: "Install a skill from GitHub (owner/repo) or a built-in metalworking skill name",
  builder: (yargs: Argv) =>
    yargs
      .positional("source", {
        type: "string",
        describe: "Skill source: owner/repo, owner/repo@skill-name, or built-in name",
      })
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        describe: "Install to global config (~/.config/nikcli/skills)",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      }),
  async handler(args) {
    const source = String(args.source ?? "").trim()
    if (!source) {
      UI.error("source is required")
      process.exitCode = 1
      return
    }

    UI.empty()
    intro(`nikcli skills add ${source}`)

    const targetDir = await getSkillDir(Boolean(args.global))
    await fs.mkdir(targetDir, { recursive: true })

    // Check if it's a built-in metalworking skill
    if (BUILTIN_METALWORKING_SKILLS.includes(source)) {
      const builtinSrc = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "..",
        "..",
        "..",
        "..",
        "..",
        ".nikcli",
        "skill",
        source,
      )

      const spin = spinner()
      spin.start(`Installing built-in skill: ${source}`)

      try {
        if (!(await Filesystem.isDir(builtinSrc))) {
          spin.stop("Not found", 1)
          UI.error(`Built-in skill "${source}" not found at ${builtinSrc}`)
          process.exitCode = 1
          return
        }

        const destDir = path.join(targetDir, source)
        await fs.mkdir(destDir, { recursive: true })

        // Copy all files from builtin skill
        const glob = new Bun.Glob("**/*")
        for await (const file of glob.scan({ cwd: builtinSrc, absolute: true, onlyFiles: true })) {
          const rel = path.relative(builtinSrc, file)
          const dest = path.join(destDir, rel)
          await fs.mkdir(path.dirname(dest), { recursive: true })
          await Bun.write(dest, await Bun.file(file).arrayBuffer())
        }

        spin.stop(`Installed ${source}`)
        log.info(`Location: ${destDir}`)
      } catch (err) {
        spin.stop("Failed", 1)
        UI.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
        return
      }

      outro("Done")
      return
    }

    // GitHub source: owner/repo or owner/repo@skill-name
    const [ghPart, skillName] = source.split("@")
    const parts = ghPart.split("/")

    if (parts.length !== 2) {
      UI.error(`Invalid source format. Use: owner/repo, owner/repo@skill-name, or a built-in name.`)
      UI.error(`Built-in metalworking skills: ${BUILTIN_METALWORKING_SKILLS.join(", ")}`)
      process.exitCode = 1
      return
    }

    const [owner, repo] = parts

    if (!args.yes) {
      const ok = await confirm({
        message: `Install skill(s) from github.com/${owner}/${repo}?`,
        initialValue: true,
      })
      if (!ok) {
        outro("Cancelled")
        return
      }
    }

    const { installed, errors } = await installFromGitHub(owner, repo, skillName, targetDir)

    if (errors.length > 0) {
      for (const e of errors) log.error(e)
    }

    if (installed.length === 0) {
      UI.error("No skills were installed")
      process.exitCode = 1
    } else {
      outro(`Installed ${installed.length} skill(s): ${installed.join(", ")}`)
    }
  },
})

const SkillsListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "List all available skills",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Output as JSON",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const skills = await listSkills()

      if (args.json) {
        process.stdout.write(JSON.stringify(skills, null, 2) + "\n")
        return
      }

      if (skills.length === 0) {
        log.info("No skills installed.")
        log.info(`Install metalworking skills: nikcli skills add text-to-cad`)
        return
      }

      const byCategory = new Map<string, Skill.Info[]>()
      for (const s of skills) {
        const cat = s.category ?? "general"
        if (!byCategory.has(cat)) byCategory.set(cat, [])
        byCategory.get(cat)!.push(s)
      }

      for (const [cat, catSkills] of byCategory) {
        console.log(`\n  ${UI.Style.TEXT_INFO_BOLD}${cat.toUpperCase()}${UI.Style.TEXT_NORMAL}`)
        for (const s of catSkills) {
          const tags = s.tags?.length ? ` [${s.tags.slice(0, 3).join(", ")}]` : ""
          console.log(`    ${UI.Style.TEXT_SUCCESS_BOLD}${s.name}${UI.Style.TEXT_NORMAL}${tags}`)
          console.log(`      ${s.description}`)
        }
      }
      console.log()
    })
  },
})

const SkillsRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm", "uninstall"],
  describe: "Remove an installed skill",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", describe: "Skill name to remove" })
      .option("yes", { alias: "y", type: "boolean", default: false }),
  async handler(args) {
    const name = String(args.name ?? "").trim()
    UI.empty()
    intro(`nikcli skills remove ${name}`)

    if (!args.yes) {
      const ok = await confirm({ message: `Remove skill "${name}"?`, initialValue: false })
      if (!ok) { outro("Cancelled"); return }
    }

    await bootstrap(process.cwd(), async () => {
      const removed = await runSkill(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          return yield* skill.remove(name)
        }),
      )
      if (removed) {
        log.success(`Removed skill: ${name}`)
      } else {
        log.error(`Skill "${name}" not found`)
        process.exitCode = 1
      }
    })

    outro("Done")
  },
})

const SkillsCreateCommand = cmd({
  command: "create <name>",
  aliases: ["new", "init"],
  describe: "Create a new skill scaffold",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", describe: "Skill name (kebab-case)" })
      .option("description", { alias: "d", type: "string", describe: "Short description" })
      .option("category", { alias: "c", type: "string", describe: "Category (e.g. metalworking)" })
      .option("global", { alias: "g", type: "boolean", default: false }),
  async handler(args) {
    const name = String(args.name ?? "").trim()
    if (!name) { UI.error("name is required"); process.exitCode = 1; return }

    UI.empty()
    intro(`Create skill: ${name}`)

    await bootstrap(process.cwd(), async () => {
      const info = await runSkill(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          return yield* skill.create({
            name,
            description: args.description ?? `Skill: ${name}`,
            category: args.category,
            scope: args.global ? "global" : "workspace",
          })
        }),
      )
      log.success(`Created skill: ${info.name}`)
      log.info(`Edit: ${info.location}`)
    })

    outro("Done")
  },
})

// ---------------------------------------------------------------------------
// Root skills command
// ---------------------------------------------------------------------------

export const SkillsCommand = cmd({
  command: "skills <subcommand>",
  aliases: ["skill"],
  describe: "Manage nikcli skills — install, list, create, and remove",
  builder: (yargs: Argv) =>
    yargs
      .command(SkillsAddCommand as any)
      .command(SkillsListCommand as any)
      .command(SkillsRemoveCommand as any)
      .command(SkillsCreateCommand as any)
      .demandCommand(1, "Specify a subcommand: add, list, remove, create")
      .epilog(
        [
          "Metalworking skills (built-in):",
          "  nikcli skills add text-to-cad",
          "  nikcli skills add solidworks-automation",
          "  nikcli skills add fusion360-api",
          "  nikcli skills add hypermill-cam",
          "  nikcli skills add cnc-gcode",
          "  nikcli skills add metalworking-dfm",
          "  nikcli skills add cad-formats",
          "",
          "From GitHub:",
          "  nikcli skills add earthtojake/text-to-cad",
          "  nikcli skills add owner/repo@specific-skill",
        ].join("\n"),
      ),
  handler() {},
})
