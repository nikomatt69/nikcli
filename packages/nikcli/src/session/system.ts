import { Config } from "../config/config"
import { resolveLocale } from "../locale/resolve"
import { Log } from "../util/log"
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_SUMMARIZE from "./prompt/summarize.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import type { Provider } from "@/provider/provider"
import { Skill } from "@/skill"
import { Context, Effect, Layer } from "effect"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"

const log = Log.create({ service: "system-prompt" })

export namespace SystemPrompt {
  export interface Interface {
    environment(): Effect.Effect<string[], unknown>
    custom(disabled?: string[]): Effect.Effect<string[], unknown>
    skills(names?: string[]): Effect.Effect<string[], unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("SystemPrompt.Service") {}

  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function summarize(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_SUMMARIZE]
      default:
        return [PROMPT_SUMMARIZE]
    }
  }

  export function title(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_TITLE]
      default:
        return [PROMPT_TITLE]
    }
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  async function environmentImpl(ctx: InstanceContext, config: Config.Info) {
    const project = ctx.project
    const loc = resolveLocale(config.locale)
    const parts = [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${ctx.directory}`,
        `  Workspace root folder: ${ctx.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `  User locale: ${loc.locale}`,
        `  User region: ${loc.region}`,
        `  User timezone: ${loc.timezone}`,
        `</env>`,
      ].join("\n"),
    ]
    if (loc.replyLanguage) {
      parts.push(
        [
          `<language>`,
          `The user's language is ${loc.languageName} (${loc.replyLanguage}). Unless the user writes to you in another language or explicitly asks otherwise, write your responses in ${loc.languageName}.`,
          `Keep code, identifiers, file paths, shell commands, and technical terms in their original form.`,
          `</language>`,
        ].join("\n"),
      )
    }
    return parts
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

  async function customImpl(ctx: InstanceContext, config: Config.Info, disabled: string[] = []) {
    const { collectSystemPaths, readInstructionContents, fetchInstructionUrls } = await import("./instruction")
    const { paths, urls } = await collectSystemPaths(ctx, config)
    // Drop instruction files/urls the user disabled for this session so the
    // model never sees them — the only way to actually shrink that context.
    const disabledSet = new Set(disabled)
    const enabledPaths = new Set([...paths].filter((p) => !disabledSet.has(p)))
    const enabledUrls = urls.filter((u) => !disabledSet.has(u))
    const [fileContents, urlContents] = await Promise.all([
      readInstructionContents(enabledPaths),
      fetchInstructionUrls(enabledUrls),
    ])
    return [...fileContents, ...urlContents]
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
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const cfg = yield* Effect.promise(() => configGet(ctx))
            return yield* Effect.tryPromise(() => environmentImpl(ctx, cfg))
          }),
        custom: (disabled = []) =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const cfg = yield* Effect.promise(() => configGet(ctx))
            return yield* Effect.tryPromise(() => customImpl(ctx, cfg, disabled))
          }),
        skills: (names = []) => Effect.tryPromise(() => skillsImpl(skill, names)),
      })
    }),
  )

  export const defaultLayer = Layer.unwrap(Effect.sync(() => layer.pipe(Layer.provide(Skill.defaultLayer))))
}
