import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@/global"
import path from "path"
import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_DELEGATION from "./prompt/delegation.txt"
import PROMPT_DELEGATOR from "./prompt/delegator.txt"
import PROMPT_ULTRAREVIEW_REVIEWER from "./prompt/ultrareview-reviewer.txt"
import { Context, Effect, Layer, Schema } from "effect"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { zodObject } from "@/util/effect-zod"

function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>) {
  return runPromiseWithLayer(Auth.defaultLayer, effect)
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>, ctx: InstanceContext) {
  return runPromiseWithLayer(Provider.defaultLayer, locallyInstance(ctx, effect))
}

const PRIMARY_AGENT_DELEGATION_AWARENESS = `

${PROMPT_DELEGATION}
`

const PRIMARY_AGENT_RESEARCH_AWARENESS = `

When you identify a knowledge gap, outdated external dependency question, missing docs context, or a decision that needs evidence, proactively launch a background research run with the task tool using subagent_type: "researcher".

- Launch research only when it materially improves the result; skip it for purely local or mechanical tasks.
- Keep only one active research run per parent session unless the existing one is clearly irrelevant.
- While research runs, continue any independent work instead of blocking.
- When the research becomes relevant, use delegator or delegation to read and incorporate the result.
`

export namespace Agent {
  const ModelRefSchema = Schema.Struct({
    modelID: Schema.String,
    providerID: Schema.String,
  })

  const InfoSchema = Schema.mutable(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      mode: Schema.Literal("subagent", "primary", "all"),
      native: Schema.optional(Schema.Boolean),
      hidden: Schema.optional(Schema.Boolean),
      topP: Schema.optional(Schema.Number),
      temperature: Schema.optional(Schema.Number),
      color: Schema.optional(Schema.String),
      permission: Schema.mutable(Schema.Array(PermissionNext.RuleSchema)),
      model: Schema.optional(ModelRefSchema),
      advisor: Schema.optional(
        Schema.Struct({
          model: ModelRefSchema,
          maxUses: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
        }),
      ),
      variant: Schema.optional(Schema.String),
      prompt: Schema.optional(Schema.String),
      options: Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
      steps: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
    }),
  ).annotations({ identifier: "Agent" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  export const SUBAGENT_TOOLSETS: Record<string, string[]> = {
    "fast-explore": ["read", "grep", "glob", "list", "tree"],
    planner: ["read", "grep", "glob", "list", "tree", "websearch", "codesearch", "webfetch"],
    general: [],
    explore: ["read", "grep", "glob", "list", "bash", "webfetch", "websearch", "codesearch"],
    researcher: [
      "read",
      "grep",
      "glob",
      "list",
      "tree",
      "websearch",
      "webfetch",
      "docs_search",
      "docs_request",
      "smart_docs",
      "docs_context",
      "memory_search",
      "context_collect",
      "context_search",
      "context_related",
      "task",
      "delegation",
      "delegator",
    ],
    "code-reviewer": ["read", "grep", "glob", "list", "bash"],
    debugger: ["read", "grep", "glob", "list", "bash", "edit"],
    "test-runner": ["read", "grep", "list", "bash", "edit", "write"],
    refactor: ["read", "grep", "glob", "list", "bash", "edit", "write", "apply_patch"],
  }

  export interface Interface {
    get(agent: string): Effect.Effect<Info | undefined>
    list(): Effect.Effect<Info[], unknown>
    defaultAgent(): Effect.Effect<string, unknown>
    generate(input: { description: string; model?: { providerID: string; modelID: string } }): Effect.Effect<
      {
        identifier: string
        whenToUse: string
        systemPrompt: string
      },
      unknown
    >
  }

  export class Service extends Context.Tag("Agent.Service")<Service, Interface>() {}

  async function buildState(worktree: string, cfg: Config.Info) {
    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
        [Truncate.GLOB]: "allow",
      },
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      ralph: {
        name: "ralph",
        description:
          "Autonomous loop agent that iterates on a task until complete. Best for large refactors, migrations, and multi-step tasks with clear done criteria.",
        prompt: `You are an autonomous agent that iterates on a task until complete.

You are aware of the project context (directory, worktree) and can use all available tools.
You have access to subagents that can be launched as background tasks.${PRIMARY_AGENT_DELEGATION_AWARENESS}${PRIMARY_AGENT_RESEARCH_AWARENESS}`,
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      build: {
        name: "build",
        prompt: `You are a build agent focused on creating and implementing features.

You are aware of the project context (directory, worktree) and can use all available tools.
You have access to subagents that can be launched as background tasks.${PRIMARY_AGENT_DELEGATION_AWARENESS}${PRIMARY_AGENT_RESEARCH_AWARENESS}`,
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      plan: {
        name: "plan",
        prompt: `You are a planning agent for multi-step implementation strategies.

You are aware of the project context (directory, worktree) and can use all available tools.
You have access to subagents that can be launched as background tasks.${PRIMARY_AGENT_DELEGATION_AWARENESS}${PRIMARY_AGENT_RESEARCH_AWARENESS}`,
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_exit: "allow",
            external_directory: {
              [path.join(Global.Path.data, "plans", "*")]: "allow",
            },
            edit: {
              "*": "deny",
              [path.join(".nikcli", "plans", "*.md")]: "allow",
              [path.relative(worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
      },
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "all",
        native: true,
      },
      "fast-explore": {
        name: "fast-explore",
        description: "Fast read-only explorer for quick codebase inspection.",
        prompt: `You are a fast exploration agent.

Use tools: read, grep, glob, list, tree.
Do not modify files.
Report findings with exact file paths and concise notes.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            tree: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
      },
      planner: {
        name: "planner",
        description: "Planning agent for multi-step implementation strategies.",
        prompt: `You are a planning agent.

Use tools: read, grep, glob, list, tree, websearch, codesearch, webfetch.
Do not modify files.
Produce a clear, step-by-step plan with file paths.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            tree: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
      },
      researcher: {
        name: "researcher",
        description:
          "Read-only research agent for collecting evidence in the background and returning source-backed findings.",
        prompt: `You are a research agent.

Your job is to investigate a question, collect evidence, and return a concise, source-backed report.

Rules:
- Stay read-only. Do not modify files, run shell commands, or mutate external systems.
- Prefer local context first: loaded docs, project context, memory, and repository files before generic web search.
- Use web search and web fetch when freshness or external evidence is required.
- Deduplicate claims and URLs.
- If evidence conflicts, say so explicitly.
- If confidence is low, say so explicitly.
- If helpful, delegate parallel read-only subtasks only to @fast-explore or @planner. Never delegate to @researcher.
- Stop when you have enough evidence; do not loop forever.

Return a final report in this structure:

Question: <one line>
Confidence: <high|medium|low>

Findings:
- <finding with source>
- <finding with source>

Open Questions:
- <question or "None">

Sources:
- <url or file path>
- <url or file path>`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            tree: "allow",
            websearch: "allow",
            webfetch: "allow",
            docs_search: "allow",
            docs_request: "allow",
            smart_docs: "allow",
            docs_context: "allow",
            memory_search: "allow",
            context_collect: "allow",
            context_search: "allow",
            context_related: "allow",
            delegation: "allow",
            delegator: "allow",
            task: {
              "fast-explore": "allow",
              planner: "allow",
              researcher: "deny",
              "*": "deny",
            },
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
        hidden: true,
      },
      "code-reviewer": {
        name: "code-reviewer",
        description: "Code review agent focused on quality and safety.",
        prompt: `You are a code reviewer.

Use tools: read, grep, glob, list, bash.
Review changes and report issues with file paths and fixes.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
      },
      "ultrareview-reviewer": {
        name: "ultrareview-reviewer",
        description: "Specialized reviewer agent for a single domain within an ultrareview parallel fleet.",
        prompt: PROMPT_ULTRAREVIEW_REVIEWER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            external_directory: {
              "*": "allow",
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
        hidden: true,
      },
      debugger: {
        name: "debugger",
        description: "Debugging agent for failures and runtime issues.",
        prompt: `You are a debugging agent.

Use tools: read, grep, glob, list, bash, edit.
Identify root cause and apply minimal fixes.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            edit: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
      },
      "test-runner": {
        name: "test-runner",
        description: "Test runner for executing and analyzing tests.",
        prompt: `You are a test runner agent.

Use tools: read, grep, list, bash, edit.
Run tests, analyze failures, and propose fixes.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            list: "allow",
            bash: "allow",
            edit: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
      },
      refactor: {
        name: "refactor",
        description: "Refactor agent for cleanups without behavior changes.",
        prompt: `You are a refactor agent.

Use tools: read, grep, glob, list, bash, edit.
Apply small, safe refactors and verify results.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            edit: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
      },
      delegator: {
        name: "delegator",
        description: "Coordination agent that synthesizes background subagent results.",
        mode: "subagent",
        native: true,
        hidden: true,
        prompt: PROMPT_DELEGATOR,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            task: "allow", // required: DelegationTool.execute calls ctx.ask({ permission: "task" })
            read: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        options: {},
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_SUMMARY,
      },
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      if (value.advisor) {
        item.advisor = {
          model: Provider.parseModel(value.advisor),
          maxUses: value.advisor_max_uses,
        }
      } else {
        item.advisor = undefined
      }
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.DIR || r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  }

  const layer = Layer.scoped(
    Service,
    Effect.gen(function* () {
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

      const state = yield* InstanceState.make<Record<string, Info>>((ctx) =>
        Effect.gen(function* () {
          const cfg = yield* Effect.promise(() => configGet(ctx))
          return yield* Effect.tryPromise(() => buildState(ctx.worktree, cfg)).pipe(Effect.orDie)
        }),
      )
      const getState = () => InstanceState.get(state)

      function list() {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const cfg = yield* Effect.promise(() => configGet(ctx))
          return pipe(
            yield* getState(),
            values(),
            sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
          )
        })
      }

      return Service.of({
        get: (agent) => getState().pipe(Effect.map((state) => state[agent])),
        list,
        defaultAgent: () =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const cfg = yield* Effect.promise(() => configGet(ctx))
            const agents = yield* getState()

            if (cfg.default_agent) {
              const agent = agents[cfg.default_agent]
              if (!agent) return yield* Effect.fail(new Error(`default agent "${cfg.default_agent}" not found`))
              if (agent.mode === "subagent")
                return yield* Effect.fail(new Error(`default agent "${cfg.default_agent}" is a subagent`))
              if (agent.hidden === true)
                return yield* Effect.fail(new Error(`default agent "${cfg.default_agent}" is hidden`))
              return agent.name
            }

            const primaryVisible = (yield* list()).find((a) => a.mode !== "subagent" && a.hidden !== true)
            if (!primaryVisible) return yield* Effect.fail(new Error("no primary visible agent found"))
            return primaryVisible.name
          }),
        generate: (input) =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const cfg = yield* Effect.promise(() => configGet(ctx))
            const { defaultModel, model, language } = yield* Effect.promise(() =>
              runProvider(
                Effect.gen(function* () {
                  const provider = yield* Provider.Service
                  const defaultModel = input.model ?? (yield* provider.defaultModel())
                  const model = yield* provider.getModel(defaultModel.providerID, defaultModel.modelID)
                  const language = yield* provider.getLanguage(model)
                  return { defaultModel, model, language }
                }),
                ctx,
              ),
            )

            const system = SystemPrompt.header(defaultModel.providerID)
            system.push(PROMPT_GENERATE)
            const existing = yield* list()

            const params = {
              experimental_telemetry: {
                isEnabled: cfg.experimental?.openTelemetry,
                metadata: {
                  userId: cfg.username ?? "unknown",
                },
              },
              temperature: 0.3,
              messages: [
                ...system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                ),
                {
                  role: "user",
                  content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
                },
              ],
              model: language,
              schema: z.object({
                identifier: z.string(),
                whenToUse: z.string(),
                systemPrompt: z.string(),
              }),
            } satisfies Parameters<typeof generateObject>[0]

            const auth = yield* Effect.promise(() =>
              runAuth(
                Effect.gen(function* () {
                  const auth = yield* Auth.Service
                  return yield* auth.get(defaultModel.providerID)
                }),
              ),
            )
            if (defaultModel.providerID === "openai" && auth?.type === "oauth") {
              return yield* Effect.promise(async () => {
                const result = streamObject({
                  ...params,
                  providerOptions: ProviderTransform.providerOptions(model, {
                    instructions: SystemPrompt.instructions(),
                    store: false,
                  }),
                  onError: () => {},
                })
                for await (const part of result.fullStream) {
                  if (part.type === "error") throw part.error
                }
                return result.object
              })
            }

            const result = yield* Effect.promise(() => generateObject(params))
            return result.object
          }),
      })
    }),
  )

  export const defaultLayer = layer
}
