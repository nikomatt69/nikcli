import { SearchBackend } from "../file/searchBackend"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import path from "path"
import os from "os"
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_CODEX from "./prompt/codex_header.txt"
import type { Provider } from "@/provider/provider"
import { Flag } from "@/flag/flag"
import { getContextSummary, getLoadedDocs } from "@/docs/context"
import { Skill } from "@/skill"

const log = Log.create({ service: "system-prompt" })

async function resolveRelativeInstruction(instruction: string): Promise<string[]> {
  if (!Flag.NIKCLI_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
  }
  if (!Flag.NIKCLI_CONFIG_DIR) {
    log.warn(
      `Skipping relative instruction "${instruction}" - no NIKCLI_CONFIG_DIR set while project config is disabled`,
    )
    return []
  }
  return Filesystem.globUp(instruction, Flag.NIKCLI_CONFIG_DIR, Flag.NIKCLI_CONFIG_DIR).catch(() => [])
}

export namespace SystemPrompt {
  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment() {
    const project = Instance.project
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<files>`,
        `  ${
          project.vcs === "git" && false
            ? await SearchBackend.tree({
                cwd: Instance.directory,
                limit: 200,
              })
            : ""
        }`,
        `</files>`,
      ].join("\n"),
    ]
  }

  const LOCAL_RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md" , ".github/instructions/memory.instruction.md"]
  const GLOBAL_RULE_FILES = [path.join(Global.Path.config, "AGENTS.md")]
  if (!Flag.NIKCLI_DISABLE_CLAUDE_CODE_PROMPT) {
    GLOBAL_RULE_FILES.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }

  if (Flag.NIKCLI_CONFIG_DIR) {
    GLOBAL_RULE_FILES.push(path.join(Flag.NIKCLI_CONFIG_DIR, "AGENTS.md"))
  }

  export async function custom() {
    const config = await Config.get()
    const paths = new Set<string>()

    if (!Flag.NIKCLI_DISABLE_PROJECT_CONFIG) {
      for (const localRuleFile of LOCAL_RULE_FILES) {
        const matches = await Filesystem.findUp(localRuleFile, Instance.directory, Instance.worktree)
        if (matches.length > 0) {
          matches.forEach((path) => paths.add(path))
          break
        }
      }
    }

    for (const globalRuleFile of GLOBAL_RULE_FILES) {
      if (await Bun.file(globalRuleFile).exists()) {
        paths.add(globalRuleFile)
        break
      }
    }

    const urls: string[] = []
    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
          urls.push(instruction)
          continue
        }
        if (instruction.startsWith("~/")) {
          instruction = path.join(os.homedir(), instruction.slice(2))
        }
        let matches: string[] = []
        if (path.isAbsolute(instruction)) {
          matches = await Array.fromAsync(
            new Bun.Glob(path.basename(instruction)).scan({
              cwd: path.dirname(instruction),
              absolute: true,
              onlyFiles: true,
            }),
          ).catch(() => [])
        } else {
          matches = await resolveRelativeInstruction(instruction)
        }
        matches.forEach((path) => paths.add(path))
      }
    }

    const foundFiles = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => "Instructions from: " + p + "\n" + x),
    )
    const foundUrls = urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
    )
    return Promise.all([...foundFiles, ...foundUrls]).then((result) => result.filter(Boolean))
  }

  export async function docs() {
    const loaded = await getLoadedDocs()
    if (loaded.length === 0) return []
    const summary = await getContextSummary()
    if (!summary) return []
    const block = ["<docs-context>", summary, "</docs-context>"].join("\n")
    if (!block.trim()) return []
    return [block]
  }

  export async function skills(names: string[] = []) {
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length === 0) return []

    const loaded = (await Promise.all(uniqueNames.map((name) => Skill.load(name).catch(() => undefined)))).filter(
      (skill): skill is NonNullable<Awaited<ReturnType<typeof Skill.load>>> => !!skill,
    )

    if (loaded.length === 0) return []

    return [
      [
        "<active_skills>",
        "The user explicitly loaded the following skills earlier in this session.",
        "Use them as reference and follow them when they help with the current request.",
        "Higher-priority system instructions and later user messages override them.",
        ...loaded.map((skill) =>
          [
            `## Skill: ${skill.name}`,
            `**Slash command**: /${Skill.commandName(skill.name)}`,
            skill.category ? `**Category**: ${skill.category}` : null,
            skill.tags?.length ? `**Tags**: ${skill.tags.join(", ")}` : null,
            skill.version ? `**Version**: ${skill.version}` : null,
            `**Base directory**: ${skill.dir}`,
            "",
            skill.content,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        "</active_skills>",
      ].join("\n\n"),
    ]
  }
}
