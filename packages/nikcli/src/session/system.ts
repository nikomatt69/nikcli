import { SearchBackend } from "../file/searchBackend"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import { Log } from "../util/log"
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
import { Skill } from "@/skill"
import { Context, Effect, Layer } from "effect"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"

const log = Log.create({ service: "system-prompt" })

async function resolveRelativeInstruction(ctx: InstanceContext, instruction: string): Promise<string[]> {
  if (!Flag.NIKCLI_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, ctx.directory, ctx.worktree).catch(() => [])
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
  export interface Interface {
    environment(): Effect.Effect<string[], unknown>
    custom(): Effect.Effect<string[], unknown>
    skills(names?: string[]): Effect.Effect<string[], unknown>
  }

  export class Service extends Context.Tag("SystemPrompt.Service")<Service, Interface>() {}

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

  const LOCAL_RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md", ".github/instructions/memory.instruction.md"]
  const GLOBAL_RULE_FILES = [path.join(Global.Path.config, "AGENTS.md")]
  if (!Flag.NIKCLI_DISABLE_CLAUDE_CODE_PROMPT) {
    GLOBAL_RULE_FILES.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }

  if (Flag.NIKCLI_CONFIG_DIR) {
    GLOBAL_RULE_FILES.push(path.join(Flag.NIKCLI_CONFIG_DIR, "AGENTS.md"))
  }

  async function environmentImpl(ctx: InstanceContext) {
    const project = ctx.project
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${ctx.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<files>`,
        `  ${
          project.vcs === "git" && false
            ? await SearchBackend.tree({
                cwd: ctx.directory,
                limit: 200,
              })
            : ""
        }`,
        `</files>`,
      ].join("\n"),
    ]
  }

  async function customImpl(ctx: InstanceContext, config: Config.Info) {
    const paths = new Set<string>()

    if (!Flag.NIKCLI_DISABLE_PROJECT_CONFIG) {
      for (const localRuleFile of LOCAL_RULE_FILES) {
        const matches = await Filesystem.findUp(localRuleFile, ctx.directory, ctx.worktree)
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
          matches = await resolveRelativeInstruction(ctx, instruction)
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

  async function skillsImpl(skill: Skill.Interface, names: string[] = []) {
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length === 0) return []

    const loaded = (
      await Promise.all(uniqueNames.map((name) => Effect.runPromise(skill.load(name)).catch(() => undefined)))
    ).filter((skill): skill is Skill.Loaded => !!skill)

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

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      function configGet(ctx: InstanceContext) {
        return runPromiseWithLayer(
          Config.defaultLayer,
          locallyInstance(
            ctx,
            Effect.gen(function* () {
              const config = yield* Config.Service
              return yield* config.get()
            }),
          ),
        )
      }

      return Service.of({
        environment: () =>
          InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise(() => environmentImpl(ctx)))),
        custom: () =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const cfg = yield* Effect.promise(() => configGet(ctx))
            return yield* Effect.tryPromise(() => customImpl(ctx, cfg))
          }),
        skills: (names = []) => Effect.tryPromise(() => skillsImpl(skill, names)),
      })
    }),
  )

  export const defaultLayer = Layer.unwrapEffect(Effect.sync(() => layer.pipe(Layer.provide(Skill.defaultLayer))))
}
