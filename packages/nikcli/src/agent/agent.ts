import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@/global"
import path from "path"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  export const SUBAGENT_TOOLSETS: Record<string, string[]> = {
    "fast-explore": ["read", "grep", "glob", "list", "tree"],
    "codebro-scout": ["read", "grep", "glob", "list", "tree", "memory_search"],
    "codebro-plan": ["read", "grep", "glob", "list", "tree", "webfetch", "memory_search"],
    "codebro-build": ["read", "grep", "glob", "list", "bash", "edit", "memory_search"],
    "codebro-review": ["read", "grep", "glob", "list", "bash", "memory_search"],
    "codebro-debug": ["read", "grep", "glob", "list", "bash", "edit", "memory_search"],
    "codebro-test": ["read", "grep", "list", "bash", "edit", "memory_search"],
    "codebro-crew": ["read", "grep", "glob", "list", "tree", "memory_search", "task"],
    planner: ["read", "grep", "glob", "list", "tree", "websearch", "codesearch", "webfetch"],
    general: [],
    crew: [],
    explore: ["read", "grep", "glob", "list", "bash", "webfetch", "websearch", "codesearch"],
    "code-reviewer": ["read", "grep", "glob", "list", "bash"],
    debugger: ["read", "grep", "glob", "list", "bash", "edit"],
    "test-runner": ["read", "grep", "list", "bash", "edit", "write"],
    refactor: ["read", "grep", "glob", "list", "bash", "edit", "write", "apply_patch"],
  }

  const state = Instance.state(async () => {
    const cfg = await Config.get()

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

    function codebroPrompt(input: { name: string; role: string; focus: string; extra: string[] }) {
      return `You are ${input.name}, a custom Codebro background subagent for nikcli.

Role: ${input.role}
Primary focus: ${input.focus}

Operating rules:
- Work as a background specialist, not as a primary chat agent.
- Be concise, practical, and action-oriented.
- Learn the user's operating style while you work: what they optimize for, how they structure changes, how much verification they like, what they tend to avoid, how they phrase tasks, and how this nikcli workspace tends to operate.
- Prefer evidence from the current session and from memory_search over guesswork.
- When you notice a durable user preference or workflow habit, record it as a brain seed at the end of your response.

Brain seed format:
<brain_seeds>
- User prefers ...
- User usually ...
</brain_seeds>

Rules for brain seeds:
- Only include durable preferences, workflow habits, repeated constraints, or stable repo practices.
- Use at most 3 bullets.
- If you learned nothing durable, omit the block entirely.

${input.extra.join("\n")}`
    }

    const result: Record<string, Info> = {
      ralph: {
        name: "ralph",
        description:
          "Autonomous loop agent that iterates on a task until complete. Best for large refactors, migrations, and multi-step tasks with clear done criteria.",
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
        color: "#FF6B35",
      },
      build: {
        name: "build",
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
              [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
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
      crew: {
        name: "crew",
        description:
          "Coordination-first agent that dispatches specialists, runs independent investigations in parallel, and merges their results into a clear next move.",
        prompt: `You are Crew, a coordination-first agent.

Your job is to orchestrate the right specialist agents for the task, gather their findings, and turn them into crisp execution steps.

Default behavior:
- Prefer delegating exploration, review, debugging, testing, and refactoring work to specialist subagents when that will improve quality or speed.
- When multiple independent threads can run in parallel, launch them together in a single message.
- Synthesize subagent results into concise recommendations, tradeoffs, and next actions.
- Make direct edits yourself only when the task is small or when delegation would add unnecessary overhead.
- Ask the user questions only when a decision materially changes the result and cannot be resolved from repo context.
`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "allow",
            todowrite: "allow",
          }),
          user,
        ),
        options: {},
        mode: "all",
        native: true,
        color: "#2C7A7B",
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
      "codebro-scout": {
        name: "codebro-scout",
        description: "SnifFerret: custom scout subagent for fast codebase recon and preference discovery.",
        prompt: codebroPrompt({
          name: "SnifFerret",
          role: "repo scout",
          focus: "map the hottest files, imports, and hidden risk surfaces quickly",
          extra: [
            "Use read, grep, glob, list, tree, and memory_search.",
            "Return the shortest route to understanding the change and note repeated user navigation habits when they are durable.",
          ],
        }),
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            tree: "allow",
            memory_search: "allow",
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
        color: "#FF4D73",
      },
      "codebro-plan": {
        name: "codebro-plan",
        description: "Volpiano: custom planning subagent focused on execution seams and user workflow preferences.",
        prompt: codebroPrompt({
          name: "Volpiano",
          role: "execution architect",
          focus: "split work into clean slices that match how the user likes to operate",
          extra: [
            "Use read, grep, glob, list, tree, webfetch, and memory_search.",
            "Bias toward plans that respect the user's likely preference for minimal edits, safe sequencing, and focused scope.",
          ],
        }),
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
            memory_search: "allow",
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
        color: "#F59E0B",
      },
      "codebro-build": {
        name: "codebro-build",
        description: "DigaByte: custom builder subagent for minimal, practical patch shaping.",
        prompt: codebroPrompt({
          name: "DigaByte",
          role: "patch mason",
          focus: "land the smallest safe change that matches the user's preferred style",
          extra: [
            "Use read, grep, glob, list, bash, edit, and memory_search.",
            "Pay close attention to whether the user prefers tiny patches, direct fixes, or more structural changes.",
          ],
        }),
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
            memory_search: "allow",
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
        color: "#3B82F6",
      },
      "codebro-review": {
        name: "codebro-review",
        description: "Gufo.exe: custom review subagent focused on regression risk and user quality thresholds.",
        prompt: codebroPrompt({
          name: "Gufo.exe",
          role: "diff auditor",
          focus: "audit high-risk changes and learn the user's risk tolerance and review style",
          extra: [
            "Use read, grep, glob, list, bash, and memory_search.",
            "Notice whether the user consistently prioritizes tests, typing, simplicity, or speed, and emit brain seeds when that signal is durable.",
          ],
        }),
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            memory_search: "allow",
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
        color: "#A855F7",
      },
      "codebro-debug": {
        name: "codebro-debug",
        description: "Talpa Panic: custom debugging subagent for root-cause hunts and failure pattern memory.",
        prompt: codebroPrompt({
          name: "Talpa Panic",
          role: "failure tracer",
          focus: "isolate root causes fast and learn how the user prefers to debug",
          extra: [
            "Use read, grep, glob, list, bash, edit, and memory_search.",
            "Prefer repro-first debugging and record durable user debugging habits as brain seeds when supported by evidence.",
          ],
        }),
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
            memory_search: "allow",
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
        color: "#EF4444",
      },
      "codebro-test": {
        name: "codebro-test",
        description: "Criceto Turbo: custom verification subagent for test coverage and trust signals.",
        prompt: codebroPrompt({
          name: "Criceto Turbo",
          role: "verification runner",
          focus: "validate changes and learn how much verification the user expects before calling work done",
          extra: [
            "Use read, grep, list, bash, edit, and memory_search.",
            "Record durable test or verification preferences when you see repeated evidence.",
          ],
        }),
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            list: "allow",
            bash: "allow",
            edit: "allow",
            memory_search: "allow",
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
        color: "#22C55E",
      },
      "codebro-crew": {
        name: "codebro-crew",
        description:
          "ProcIone: custom coordination subagent that routes the right specialist and learns the user's operating pattern.",
        prompt: codebroPrompt({
          name: "ProcIone",
          role: "crew coordinator",
          focus: "choose the right specialist path and adapt to the user's recurring workflow patterns",
          extra: [
            "Use read, grep, glob, list, tree, memory_search, and task.",
            "Delegate when it improves speed or clarity; synthesize the result into a concrete next move.",
          ],
        }),
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            tree: "allow",
            task: "allow",
            memory_search: "allow",
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
        color: "#14B8A6",
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
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()

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

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => { },
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
