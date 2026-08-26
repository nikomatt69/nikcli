import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "@nikcli-ai/util/global"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import path from "path"
import fs from "fs/promises"
import matter from "gray-matter"
import { EOL } from "os"
import type { Argv } from "yargs"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Log } from "@nikcli-ai/util/log"
import z from "zod"

const log = Log.create({ service: "agent-command" })

type AgentMode = "all" | "primary" | "subagent"

const AgentModeSchema = z.enum(["all", "primary", "subagent"])

const AVAILABLE_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "generate_image",
  "speak",
  "list",
  "glob",
  "grep",
  "webfetch",
  "task",
  "todowrite",
  "todoread",
] as const

function agentGenerate(input: { description: string; model?: { providerID: string; modelID: string } }) {
  return runPromiseWithLayer(
    Agent.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.generate(input)
      }),
    ),
  )
}

function agentList() {
  return runPromiseWithLayer(
    Agent.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.list()
      }),
    ),
  )
}

const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs: Argv) =>
    yargs
      .option("path", {
        type: "string",
        describe: "directory path to generate the agent file",
      })
      .option("description", {
        type: "string",
        describe: "what the agent should do",
      })
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"] as const,
      })
      .option("tools", {
        type: "string",
        describe: `comma-separated list of tools to enable (default: all). Available: "${AVAILABLE_TOOLS.join(", ")}"`,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      }),
  async handler(args) {
    await withInstanceAsync({ directory: process.cwd() }, async (instance) => {
      const cliPath = args.path
      const cliDescription = args.description
      const cliMode = args.mode as AgentMode | undefined
      const cliTools = args.tools

      const isFullyNonInteractive = Boolean(cliPath && cliDescription && cliMode && cliTools !== undefined)

      if (!isFullyNonInteractive) {
        UI.empty()
        prompts.intro("Create agent")
      }

      const project = instance.project
      log.debug("Creating agent", {
        projectWorktree: instance.worktree,
        isInteractive: !isFullyNonInteractive,
      })

      let targetPath: string
      if (cliPath) {
        targetPath = path.join(cliPath, "agent")
      } else {
        let scope: "global" | "project" = "global"
        if (project.vcs === "git") {
          const scopeResult = await prompts.select({
            message: "Location",
            options: [
              {
                label: "Current project",
                value: "project" as const,
                hint: instance.worktree,
              },
              {
                label: "Global",
                value: "global" as const,
                hint: Global.Path.config,
              },
            ],
          })
          if (prompts.isCancel(scopeResult)) {
            prompts.outro("Done")
            return
          }
          scope = scopeResult
        }
        targetPath = path.join(
          scope === "global" ? Global.Path.config : path.join(instance.worktree, ".nikcli"),
          "agent",
        )
      }

      let description: string
      if (cliDescription) {
        description = cliDescription
      } else {
        const query = await prompts.text({
          message: "Description",
          placeholder: "What should this agent do?",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(query)) {
          prompts.outro("Done")
          return
        }
        description = query
      }

      const spinner = prompts.spinner()
      spinner.start("Generating agent configuration...")

      const model = args.model ? Provider.parseModel(args.model) : undefined

      const generated = await agentGenerate({ description, model }).catch((error) => {
        spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
        if (isFullyNonInteractive) {
          process.exit(1)
        }
        throw new UI.CancelledError()
      })

      spinner.stop(`Agent ${generated.identifier} generated`)
      log.info("Agent generated", { identifier: generated.identifier })

      let selectedTools: string[]
      if (cliTools !== undefined) {
        selectedTools = cliTools ? cliTools.split(",").map((t) => t.trim()) : [...AVAILABLE_TOOLS]
      } else {
        const result = await prompts.multiselect({
          message: "Select tools to enable (Space to toggle)",
          options: AVAILABLE_TOOLS.map((tool) => ({
            label: tool,
            value: tool,
          })),
          initialValues: [...AVAILABLE_TOOLS],
        })
        if (prompts.isCancel(result)) {
          prompts.outro("Done")
          return
        }
        selectedTools = result
      }

      let mode: AgentMode
      if (cliMode) {
        const parsed = AgentModeSchema.safeParse(cliMode)
        if (!parsed.success) {
          log.error("Invalid agent mode", { mode: cliMode })
          throw new UI.CancelledError()
        }
        mode = parsed.data
      } else {
        const modeResult = await prompts.select({
          message: "Agent mode",
          options: [
            {
              label: "All",
              value: "all" as const,
              hint: "Can function in both primary and subagent roles",
            },
            {
              label: "Primary",
              value: "primary" as const,
              hint: "Acts as a primary/main agent",
            },
            {
              label: "Subagent",
              value: "subagent" as const,
              hint: "Can be used as a subagent by other agents",
            },
          ],
          initialValue: "all" as const,
        })
        if (prompts.isCancel(modeResult)) {
          prompts.outro("Done")
          return
        }
        mode = modeResult
      }

      const tools: Record<string, boolean> = {}
      for (const tool of AVAILABLE_TOOLS) {
        if (!selectedTools.includes(tool)) {
          tools[tool] = false
        }
      }

      const frontmatter: {
        description: string
        mode: AgentMode
        tools?: Record<string, boolean>
      } = {
        description: generated.whenToUse,
        mode,
      }
      if (Object.keys(tools).length > 0) {
        frontmatter.tools = tools
      }

      const content = matter.stringify(generated.systemPrompt, frontmatter)
      const filePath = path.join(targetPath, `${generated.identifier}.md`)

      await fs.mkdir(targetPath, { recursive: true })

      const file = Bun.file(filePath)
      if (await file.exists()) {
        if (isFullyNonInteractive) {
          console.error(`Error: Agent file already exists: ${filePath}`)
          process.exit(1)
        }
        prompts.log.error(`Agent file already exists: ${filePath}`)
        throw new UI.CancelledError()
      }

      await Bun.write(filePath, content)

      if (isFullyNonInteractive) {
        console.log(filePath)
      } else {
        prompts.log.success(`Agent created: ${filePath}`)
        prompts.outro("Done")
      }
    })
  },
})

const AgentListCommand = cmd({
  command: "list",
  describe: "list all available agents",
  async handler() {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      const agents = await agentList()
      const sortedAgents = agents.sort((a: Agent.Info, b: Agent.Info) => {
        if (a.native !== b.native) {
          return a.native ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

      log.debug("Listed agents", { count: agents.length })

      for (const agent of sortedAgents) {
        process.stdout.write(`${agent.name} (${agent.mode})` + EOL)
        process.stdout.write(`  ${JSON.stringify(agent.permission, null, 2)}` + EOL)
      }
    })
  },
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) => yargs.command(AgentCreateCommand).command(AgentListCommand).demandCommand(),
  async handler() {
    log.debug("Agent command handler called without subcommand")
  },
})
