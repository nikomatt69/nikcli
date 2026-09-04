import { Config } from "../config/config"
import { resolveLocale } from "../locale/resolve"
import { Log } from "@nikcli-ai/util/log"
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_SUMMARIZE from "./prompt/summarize.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import type { Provider } from "@/provider/provider"
import { Profile } from "@/profile"
import { Skill } from "@/skill"
import { Context, Effect, Layer } from "effect"
import { AppRuntime, InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"

const log = Log.create({ service: "system-prompt" })

export namespace SystemPrompt {
  export interface Interface {
    environment(): Effect.Effect<string[], unknown>
    custom(disabled?: string[]): Effect.Effect<string[], unknown>
    skills(names?: string[]): Effect.Effect<string[], unknown>
    /** The signed-in user's personalization block, or `[]` when unset. */
    profile(): Effect.Effect<string[], unknown>
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
    // gpt-5.x and gpt-6 (Astra) both run the Codex harness.
    if (model.api.id.includes("gpt-5") || model.api.id.includes("gpt-6")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  const lockfileManagers: [file: string, manager: string][] = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["deno.lock", "deno"],
  ]

  export async function detectPackageManager(directory: string, worktree: string): Promise<string | undefined> {
    const roots = directory === worktree ? [directory] : [directory, worktree]
    for (const root of roots) {
      const pkg = await Bun.file(`${root}/package.json`)
        .json()
        .catch(() => undefined)
      // the packageManager field (corepack) is the project's explicit choice — it wins over lockfiles
      const declared = pkg?.packageManager
      if (typeof declared === "string" && declared.length > 0) return declared.split("@")[0]
      for (const [file, manager] of lockfileManagers) {
        if (await Bun.file(`${root}/${file}`).exists()) return manager
      }
    }
    return undefined
  }

  function runScriptHint(manager: string) {
    switch (manager) {
      case "bun":
        return "`bun install`, `bun add`, `bun run <script>`"
      case "pnpm":
        return "`pnpm install`, `pnpm add`, `pnpm <script>` (or `pnpm run <script>`)"
      case "yarn":
        return "`yarn install`, `yarn add`, `yarn <script>`"
      case "deno":
        return "`deno install`, `deno task <task>`"
      default:
        return "`npm install`, `npm run <script>`"
    }
  }

  async function environmentImpl(ctx: InstanceContext, config: Config.Info) {
    const project = ctx.project
    const loc = resolveLocale(config.locale)
    const packageManager = await detectPackageManager(ctx.directory, ctx.worktree).catch(() => undefined)
    const parts = [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${ctx.directory}`,
        `  Workspace root folder: ${ctx.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        ...(packageManager ? [`  Package manager: ${packageManager}`] : []),
        `  Today's date: ${new Date().toDateString()}`,
        `  User locale: ${loc.locale}`,
        `  User region: ${loc.region}`,
        `  User timezone: ${loc.timezone}`,
        `</env>`,
      ].join("\n"),
      [
        `<command_execution>`,
        `Background-first policy: anything that runs for more than a few seconds runs in the background. You keep working while it runs and the session is woken when it finishes.`,
        ``,
        `Process commands — use the monitor tool, never bash:`,
        `- Dev servers, watchers, log tails, and anything that never exits on its own.`,
        `- Typecheck, builds, test suites, installs, codegen — anything long-running or potentially long-running.`,
        `The bash tool blocks the current turn and will hang on these. The monitor tool runs the command in the background, persists stdout/stderr to a log file, streams live status, and wakes the session when the command finishes.`,
        `Only a short preview of the output is streamed back into the session. The full results live in the log file on disk (the "Log file:" path returned when the job starts). To inspect complete output — e.g. the full list of typecheck or build errors — read that log file with the read tool instead of relying on the preview.`,
        `Reserve bash for short, fast, clearly-bounded commands that complete in a few seconds at most (git status, ls, a quick script).`,
        ``,
        `Subagents — always background:`,
        `Launch task-tool subagents in the background (the default). Never block waiting on a subagent: launch it, continue with other work, and the completion wake will arrive in this session. Launch independent subagents together so they run concurrently.`,
        ``,
        `Package manager:`,
        packageManager
          ? `This project uses ${packageManager} (see <env>). ALWAYS use it for installing dependencies and running scripts: ${runScriptHint(packageManager)}. Never mix package managers — do not run npm/npx commands in a ${packageManager} project (use the ${packageManager} equivalent).`
          : `No package manager was detected for this project. Before installing dependencies or running scripts, check for a lockfile or the package.json "packageManager" field and use the matching tool; ask the user if it is still ambiguous.`,
        `When the user or docs mention a script generically (e.g. "run typecheck"), run it through the active package manager (e.g. \`${packageManager ?? "npm"} run typecheck\`) via the monitor tool.`,
        `</command_execution>`,
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

  export function skillBlock(skill: Skill.Loaded): string {
    return [
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
      .join("\n")
  }

  export function skillsMessage(blocks: string[]): string {
    return [
      "<active_skills>",
      "The user explicitly loaded the following skills earlier in this session.",
      "Use them as reference and follow them when they help with the current request.",
      "Higher-priority system instructions and later user messages override them.",
      ...blocks,
      "</active_skills>",
    ].join("\n\n")
  }

  async function skillsImpl(skill: Skill.Interface, names: string[] = []) {
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length === 0) return []

    const loaded = (
      await Promise.all(
        uniqueNames.map((name) =>
          AppRuntime.runPromise(skill.load(name)).catch((error) => {
            log.warn("failed to load skill for system prompt", { name, error })
            return undefined
          }),
        ),
      )
    ).filter((skill): skill is Skill.Loaded => !!skill)

    if (loaded.length === 0) return []

    return [skillsMessage(loaded.map(skillBlock))]
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
      const profile = yield* Profile.Service
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
        profile: () =>
          Effect.gen(function* () {
            // The habits file is project-local (`.nikcli/habits.md`), so the
            // reminder needs the instance's project root, not just the profile.
            const ctx = yield* InstanceState.context
            return yield* profile.reminder(Profile.projectRoot(ctx))
          }),
      })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() => layer.pipe(Layer.provide(Skill.defaultLayer), Layer.provide(Profile.defaultLayer))),
  )
}
